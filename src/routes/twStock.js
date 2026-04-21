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
  const { stocks } = req.body; // [{code, name, market, category?, isCore?}, ...]
  if (!Array.isArray(stocks) || stocks.length === 0) {
    return res.status(400).json({ error: '請提供股票清單' });
  }
  const results = [];
  const addedBy = req.session.user?.displayName || req.session.user?.username;
  for (const s of stocks) {
    if (!s.code || !s.name) continue;
    if (!/^\d{4,6}$/.test(s.code)) continue;
    const extras = {};
    if (s.category) extras.category = String(s.category);
    if (typeof s.isCore === 'boolean') extras.isCore = s.isCore;
    try {
      twStockStore.addToWatchlist(s.code.trim(), s.name.trim(), s.market || 'sii', addedBy, extras);
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

// 營收比較（多股同時比較，支援月/年）
router.get('/compare/revenue', (req, res) => {
  const codes = (req.query.codes || '').split(',').filter(Boolean);
  const mode = req.query.mode || 'monthly'; // 'monthly' or 'annual'
  const year = req.query.year; // optional filter
  if (codes.length === 0) return res.json({});

  const result = {};
  for (const code of codes) {
    const fin = twStockStore.getFinancials(code);
    const stock = twStockStore.getStock(code);
    if (!fin?.revenue) continue;

    if (mode === 'annual') {
      // Aggregate monthly → annual using 營收年份+營收月份 for correct year mapping
      const annual = {};
      for (const [key, entries] of Object.entries(fin.revenue)) {
        if (!Array.isArray(entries) || entries.length === 0) continue;
        const entry = entries[0];
        // Use 營收年份 + 營收月份 for correct mapping (e.g., 2025/12 revenue reported in 2026/01)
        const revYear = String(entry['營收年份'] || key.split('_')[0]);
        const revKey = Object.keys(entry).find(k => k.includes('營收') && !k.includes('年份') && !k.includes('月份') && !k.includes('去年') && !k.includes('上月'));
        if (year && revYear !== year) continue;
        if (!annual[revYear]) annual[revYear] = 0;
        if (revKey && typeof entry[revKey] === 'number') annual[revYear] += entry[revKey];
      }
      result[code] = { name: stock?.name || code, market: stock?.market, annual };
    } else {
      let revenue = fin.revenue;
      if (year) {
        revenue = {};
        for (const [k, v] of Object.entries(fin.revenue)) {
          if (k.startsWith(year)) revenue[k] = v;
        }
      }
      result[code] = { name: stock?.name || code, market: stock?.market, revenue };
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

// ===== 匯入到業務管線 =====

router.post('/to-pipeline', requireManagerOrAdmin, (req, res) => {
  const { stocks } = req.body; // [{code, name, logistics, priority, revenue, market}, ...]
  if (!Array.isArray(stocks) || stocks.length === 0) {
    return res.status(400).json({ error: '請選擇要匯入的公司' });
  }
  const pipelineStore = require('../services/pipelineStore');
  const existing = pipelineStore.getLeads();
  const results = [];
  const createdBy = req.session.user?.displayName || req.session.user?.username;

  for (const s of stocks) {
    // Check if already exists by company name
    const found = existing.find(l => l.companyName === s.name || l.companyName === `${s.code} ${s.name}`);
    if (found) {
      results.push({ code: s.code, name: s.name, status: 'skip', reason: '已存在' });
      continue;
    }
    try {
      const lead = pipelineStore.createLead({
        companyName: `${s.code} ${s.name}`,
        category: '潛在合作對象',
        status: '初步接觸',
        salesperson: s.salesperson || createdBy || '',
        estimatedValue: s.logistics || 0,
        notes: `來源：AI廠商營收分析\n股票代碼：${s.code}\n市場：${s.market === 'otc' ? '上櫃' : '上市'}\n年營收：${s.revenue ? (s.revenue / 1e8).toFixed(2) + ' 億' : '-'}\n預估物流費用(3%)：${s.logistics ? (s.logistics / 1e8).toFixed(2) + ' 億' : '-'}\n優先級：${s.priority}`,
        createdBy,
      });
      results.push({ code: s.code, name: s.name, status: 'ok', leadId: lead.id });
    } catch (err) {
      results.push({ code: s.code, name: s.name, status: 'error', reason: err.message });
    }
  }
  const ok = results.filter(r => r.status === 'ok').length;
  res.json({ message: `匯入完成：${ok} 家新增`, results });
});

// ===== 營收比較 + 潛力客戶 Excel 匯出 =====

router.get('/export/compare', async (req, res) => {
  const codes = (req.query.codes || '').split(',').filter(Boolean);
  const mode = req.query.mode || 'prospect'; // 'prospect', 'annual', 'monthly'

  const watchlist = twStockStore.getWatchlist();
  const targetCodes = codes.length > 0 ? codes : watchlist.map(w => w.code);
  if (targetCodes.length === 0) return res.status(400).json({ error: '無股票資料' });

  try {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'BC Reporter — 台股營收分析';
    wb.created = new Date();

    const headerFont = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
    const greenFont = { size: 10, bold: true, color: { argb: 'FF1B5E20' } };
    const redFont = { size: 10, bold: true, color: { argb: 'FFC62828' } };
    const numFmt = '#,##0';
    const pctFmt = '0.0"%"';

    // Collect annual data for all stocks
    const stockData = {};
    const allYears = new Set();
    for (const code of targetCodes) {
      const fin = twStockStore.getFinancials(code);
      const stock = twStockStore.getStock(code);
      if (!fin?.revenue) continue;
      const annual = {};
      for (const [key, entries] of Object.entries(fin.revenue)) {
        if (!Array.isArray(entries) || entries.length === 0) continue;
        const entry = entries[0];
        const revYear = String(entry['營收年份'] || key.split('_')[0]);
        const revKey = Object.keys(entry).find(k => k.includes('營收') && !k.includes('年份') && !k.includes('月份') && !k.includes('去年') && !k.includes('上月'));
        if (!annual[revYear]) annual[revYear] = 0;
        if (revKey && typeof entry[revKey] === 'number') annual[revYear] += entry[revKey];
        allYears.add(revYear);
      }
      stockData[code] = { name: stock?.name || code, market: stock?.market, annual, revenue: fin.revenue };
    }

    const years = [...allYears].sort();
    const RATE = 0.03;

    // Sheet 1: 潛力客戶開發
    const ws1 = wb.addWorksheet('潛力客戶開發');
    const headers1 = ['#', '股票代碼', '公司名稱', '市場'];
    years.forEach(y => headers1.push(`${y} 營收`));
    if (years.length >= 2) headers1.push('YoY%');
    headers1.push('預估物流費用(3%)', '優先級');

    const hr1 = ws1.addRow(headers1);
    hr1.eachCell(c => { c.font = headerFont; c.fill = headerFill; });

    const sorted = Object.entries(stockData).sort((a, b) => {
      const latestYear = years[years.length - 1];
      return (b[1].annual[latestYear] || 0) - (a[1].annual[latestYear] || 0);
    });

    sorted.forEach(([code, s], i) => {
      const latestYear = years[years.length - 1];
      const prevYear = years.length >= 2 ? years[years.length - 2] : null;
      const latestRev = s.annual[latestYear] || 0;
      const prevRev = prevYear ? (s.annual[prevYear] || 0) : 0;
      const yoy = prevRev > 0 ? ((latestRev - prevRev) / prevRev * 100) : null;
      const logistics = latestRev * RATE;
      let priority = 'C';
      if (logistics >= 1e9) priority = 'S';
      else if (logistics >= 3e8) priority = 'A';
      else if (logistics >= 1e8) priority = 'B';

      const row = [i + 1, code, s.name, s.market === 'otc' ? '上櫃' : '上市'];
      years.forEach(y => row.push(s.annual[y] || 0));
      if (years.length >= 2) row.push(yoy !== null ? yoy : '');
      row.push(logistics, priority);

      const r = ws1.addRow(row);
      // Format numbers
      years.forEach((_, yi) => { r.getCell(5 + yi).numFmt = numFmt; });
      const logCol = headers1.indexOf('預估物流費用(3%)') + 1;
      r.getCell(logCol).numFmt = numFmt;
      r.getCell(logCol).font = greenFont;
    });

    ws1.columns.forEach(col => { col.width = 16; });
    ws1.getColumn(3).width = 20;

    // Sheet 2: 年營收比較
    const ws2 = wb.addWorksheet('年營收比較');
    const headers2 = ['股票代碼', '公司名稱'];
    years.forEach(y => headers2.push(`${y}`));
    const hr2 = ws2.addRow(headers2);
    hr2.eachCell(c => { c.font = headerFont; c.fill = headerFill; });

    sorted.forEach(([code, s]) => {
      const row = [code, s.name];
      years.forEach(y => row.push(s.annual[y] || 0));
      const r = ws2.addRow(row);
      years.forEach((_, yi) => { r.getCell(3 + yi).numFmt = numFmt; });
    });
    ws2.columns.forEach(col => { col.width = 18; });

    // Sheet 3: 月營收明細 (latest 12 months)
    const ws3 = wb.addWorksheet('月營收明細');
    const allMonths = new Set();
    Object.values(stockData).forEach(s => {
      Object.keys(s.revenue || {}).forEach(k => allMonths.add(k));
    });
    const months = [...allMonths].sort().slice(-12);
    const headers3 = ['股票代碼', '公司名稱', ...months];
    const hr3 = ws3.addRow(headers3);
    hr3.eachCell(c => { c.font = headerFont; c.fill = headerFill; });

    sorted.forEach(([code, s]) => {
      const row = [code, s.name];
      months.forEach(m => {
        const entries = s.revenue?.[m];
        let val = 0;
        if (Array.isArray(entries) && entries.length > 0) {
          const entry = entries[0];
          const revKey = Object.keys(entry).find(k => k.includes('營收') && !k.includes('年份') && !k.includes('月份') && !k.includes('去年') && !k.includes('上月'));
          if (revKey && typeof entry[revKey] === 'number') val = entry[revKey];
        }
        row.push(val);
      });
      const r = ws3.addRow(row);
      months.forEach((_, mi) => { r.getCell(3 + mi).numFmt = numFmt; });
    });
    ws3.columns.forEach(col => { col.width = 16; });

    const filename = `AI_廠商營收分析_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[twStock] Excel compare export failed:', err.message);
    res.status(500).json({ error: '匯出失敗' });
  }
});

module.exports = router;
