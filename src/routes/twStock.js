// src/routes/twStock.js
// 台股財報 API 路由 — 追蹤清單管理 + 財報查詢 + MOPS 同步

const express = require('express');
const router = express.Router();
const twStockStore = require('../services/twStockStore');
const scraper = require('../services/twStockScraper');
const { requireDashboard, requireAdmin, requireManagerOrAdmin } = require('../middleware/auth');

// 所有台股路由需 'twstock' dashboard 權限
router.use(requireDashboard('twstock'));

// ===== 追蹤清單 =====

router.get('/watchlist', (req, res) => {
  const watchlist = twStockStore.getWatchlist();
  // 附加同步狀態
  const enriched = watchlist.map(w => ({
    ...w,
    lastSync: twStockStore.getLastSync(w.code),
    needsSync: twStockStore.needsSync(w.code),
  }));
  res.json(enriched);
});

router.post('/watchlist', requireManagerOrAdmin, (req, res) => {
  const { code, name, market } = req.body;
  if (!code || !name) {
    return res.status(400).json({ error: '股票代碼和名稱為必填' });
  }
  // 驗證股票代碼格式（4-6 位數字）
  if (!/^\d{4,6}$/.test(code)) {
    return res.status(400).json({ error: '股票代碼格式不正確（4-6 位數字）' });
  }
  try {
    const watchlist = twStockStore.addToWatchlist(
      code.trim(),
      name.trim(),
      market || 'sii',
      req.session.user?.displayName || req.session.user?.username
    );
    res.json({ message: `已新增 ${code} ${name}`, watchlist });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/watchlist/:code', requireManagerOrAdmin, (req, res) => {
  try {
    const watchlist = twStockStore.removeFromWatchlist(req.params.code);
    res.json({ message: `已移除 ${req.params.code}`, watchlist });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 批次匯入
router.post('/watchlist/batch', requireManagerOrAdmin, (req, res) => {
  const { stocks } = req.body; // [{code, name, market}, ...]
  if (!Array.isArray(stocks) || stocks.length === 0) {
    return res.status(400).json({ error: '請提供股票清單' });
  }
  const results = [];
  const addedBy = req.session.user?.displayName || req.session.user?.username;
  for (const s of stocks) {
    if (!s.code || !s.name) continue;
    if (!/^\d{4,6}$/.test(s.code)) continue;
    try {
      twStockStore.addToWatchlist(s.code.trim(), s.name.trim(), s.market || 'sii', addedBy);
      results.push({ code: s.code, name: s.name, status: 'ok' });
    } catch (err) {
      results.push({ code: s.code, name: s.name, status: 'skip', error: err.message });
    }
  }
  res.json({ message: `匯入完成：${results.filter(r => r.status === 'ok').length} 成功`, results });
});

// 只同步月營收（輕量模式）
router.post('/sync/:code/revenue', async (req, res) => {
  const stock = twStockStore.getStock(req.params.code);
  if (!stock) return res.status(404).json({ error: '股票不在追蹤清單中' });

  try {
    const revenue = await scraper.fetchRevenueOnly(stock.code, stock.market);
    twStockStore.mergeFinancials(stock.code, { revenue });
    res.json({ message: `${stock.code} ${stock.name} 月營收同步完成`, lastSync: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: `同步失敗: ${err.message}` });
  }
});

// 批次同步月營收（所有追蹤股票）
router.post('/sync-revenue-all', async (req, res) => {
  const watchlist = twStockStore.getWatchlist();
  if (watchlist.length === 0) return res.json({ message: '追蹤清單為空' });

  const results = [];
  for (const stock of watchlist) {
    try {
      const revenue = await scraper.fetchRevenueOnly(stock.code, stock.market);
      twStockStore.mergeFinancials(stock.code, { revenue });
      results.push({ code: stock.code, name: stock.name, status: 'ok' });
    } catch (err) {
      results.push({ code: stock.code, name: stock.name, status: 'error', error: err.message });
    }
  }
  res.json({ message: `批次月營收同步完成`, results });
});

// 營收比較（多股同時比較）
router.get('/compare/revenue', (req, res) => {
  const codes = (req.query.codes || '').split(',').filter(Boolean);
  if (codes.length === 0) return res.json({});

  const result = {};
  for (const code of codes) {
    const fin = twStockStore.getFinancials(code);
    const stock = twStockStore.getStock(code);
    if (fin?.revenue) {
      result[code] = { name: stock?.name || code, revenue: fin.revenue };
    }
  }
  res.json(result);
});

// ===== 財報查詢 =====

router.get('/financials/:code', (req, res) => {
  const stock = twStockStore.getStock(req.params.code);
  if (!stock) return res.status(404).json({ error: '股票不在追蹤清單中' });

  const financials = twStockStore.getFinancials(req.params.code);
  if (!financials) return res.json({ stock, data: null, message: '尚未同步資料，請先執行同步' });

  res.json({
    stock,
    lastSync: financials.lastSync,
    income: financials.income || {},
    balance: financials.balance || {},
    cashflow: financials.cashflow || {},
    revenue: financials.revenue || {},
  });
});

router.get('/financials/:code/income', (req, res) => {
  const data = twStockStore.getIncomeStatements(req.params.code);
  res.json(filterByQuery(data, req.query));
});

router.get('/financials/:code/balance', (req, res) => {
  const data = twStockStore.getBalanceSheets(req.params.code);
  res.json(filterByQuery(data, req.query));
});

router.get('/financials/:code/cashflow', (req, res) => {
  const data = twStockStore.getCashFlows(req.params.code);
  res.json(filterByQuery(data, req.query));
});

router.get('/financials/:code/revenue', (req, res) => {
  const data = twStockStore.getRevenue(req.params.code);
  res.json(filterByQuery(data, req.query));
});

// 篩選 helper: ?year=2024&season=1 or ?year=2024
function filterByQuery(data, query) {
  if (!data || Object.keys(data).length === 0) return {};
  const { year, season } = query;
  if (!year) return data;

  const filtered = {};
  for (const [key, val] of Object.entries(data)) {
    if (key.startsWith(year)) {
      if (season && !key.includes(`Q${season}`) && !key.endsWith(`_${String(season).padStart(2, '0')}`)) {
        continue;
      }
      filtered[key] = val;
    }
  }
  return filtered;
}

// ===== 同步 =====

router.post('/sync/:code', async (req, res) => {
  const stock = twStockStore.getStock(req.params.code);
  if (!stock) return res.status(404).json({ error: '股票不在追蹤清單中' });

  try {
    const financials = await scraper.fetchAllFinancials(stock.code, stock.market);
    twStockStore.saveFinancials(stock.code, financials);
    res.json({
      message: `${stock.code} ${stock.name} 同步完成`,
      lastSync: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[twStock] 同步失敗 ${stock.code}:`, err.message);
    res.status(500).json({ error: `同步失敗: ${err.message}` });
  }
});

router.post('/sync-all', requireAdmin, async (req, res) => {
  const watchlist = twStockStore.getWatchlist();
  if (watchlist.length === 0) {
    return res.json({ message: '追蹤清單為空' });
  }

  const results = [];
  for (const stock of watchlist) {
    try {
      const financials = await scraper.fetchAllFinancials(stock.code, stock.market);
      twStockStore.saveFinancials(stock.code, financials);
      results.push({ code: stock.code, name: stock.name, status: 'ok' });
    } catch (err) {
      results.push({ code: stock.code, name: stock.name, status: 'error', error: err.message });
    }
  }

  res.json({ message: '批次同步完成', results });
});

// ===== Excel 匯出 =====

router.get('/export/:code', async (req, res) => {
  const stock = twStockStore.getStock(req.params.code);
  if (!stock) return res.status(404).json({ error: '股票不在追蹤清單中' });

  const financials = twStockStore.getFinancials(req.params.code);
  if (!financials) return res.status(400).json({ error: '尚未同步資料' });

  try {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'BC Reporter — 台股財報';
    wb.created = new Date();

    const headerFont = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
    const titleFont = { size: 14, bold: true };

    // 匯出各類報表到不同 worksheet
    const reportTypes = [
      { key: 'income', label: '損益表' },
      { key: 'balance', label: '資產負債表' },
      { key: 'cashflow', label: '現金流量表' },
      { key: 'revenue', label: '月營收' },
    ];

    for (const rt of reportTypes) {
      const data = financials[rt.key];
      if (!data || Object.keys(data).length === 0) continue;

      const ws = wb.addWorksheet(rt.label);
      ws.addRow([`${stock.code} ${stock.name} — ${rt.label}`]);
      ws.getRow(1).font = titleFont;
      ws.addRow([]);

      // 收集所有期間的 key
      const periods = Object.keys(data).sort();

      for (const period of periods) {
        const periodData = data[period];
        if (!periodData) continue;

        ws.addRow([period]);
        ws.getRow(ws.rowCount).font = { bold: true, size: 11 };

        // 處理不同資料格式
        if (periodData.table_0) {
          // 財報格式（table_0, table_1...）
          for (const tableKey of Object.keys(periodData)) {
            const table = periodData[tableKey];
            if (!table?.items) continue;

            // 表頭
            const headerRow = ws.addRow(table.header);
            headerRow.font = headerFont;
            headerRow.fill = headerFill;

            // 資料列
            for (const item of table.items) {
              const row = [item.name];
              for (let i = 1; i < table.header.length; i++) {
                row.push(item[table.header[i]] ?? '');
              }
              ws.addRow(row);
            }
            ws.addRow([]);
          }
        } else if (Array.isArray(periodData)) {
          // 月營收格式（array of objects）
          if (periodData.length > 0) {
            const keys = Object.keys(periodData[0]);
            const headerRow = ws.addRow(keys);
            headerRow.font = headerFont;
            headerRow.fill = headerFill;
            for (const entry of periodData) {
              ws.addRow(keys.map(k => entry[k] ?? ''));
            }
          }
        }
        ws.addRow([]);
      }

      // 自動調整欄寬
      ws.columns.forEach(col => {
        col.width = 18;
      });
    }

    const filename = `${stock.code}_${stock.name}_financials.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(`[twStock] Excel 匯出失敗:`, err.message);
    res.status(500).json({ error: '匯出失敗' });
  }
});

module.exports = router;
