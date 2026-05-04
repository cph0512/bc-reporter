// src/routes/reports.js
// REST API 路由 — 支援日期範圍查詢 + Excel 匯出（中英文）

const express = require('express');
const router = express.Router();

// ===== i18n Labels for Excel export =====
const EXCEL_LABELS = {
  zh: {
    company: 'BBTruck',
    currency: '金額單位：新台幣元（NTD）',
    is: '損益表',
    bs: '資產負債表',
    ebitda: 'EBITDA 報告',
    period: '期間',
    generated: '產出時間',
    account: '科目',
    amount: '金額',
    current: '本期',
    previous: '前期',
    change: '變化',
    // IS
    revenue: '營業收入',
    totalRevenue: '營業收入合計',
    cogs: '營業成本',
    grossProfit: '營業毛利',
    opex: '營業費用',
    totalOpex: '營業費用合計',
    operatingIncome: '營業利益',
    da: '(+) 折舊攤銷',
    nonOpIncome: '營業外收入',
    nonOpExpense: '營業外費用',
    ebt: '稅前淨利',
    tax: '所得稅費用',
    netIncome: '稅後淨利',
    grossMargin: '毛利率',
    opMargin: '營業利益率',
    ebitdaMargin: 'EBITDA 利潤率',
    netMargin: '淨利率',
    // BS
    assetsH: '資產',
    currentAssets: '流動資產',
    totalCurrentAssets: '流動資產合計',
    nonCurrentAssets: '非流動資產',
    totalNonCurrentAssets: '非流動資產合計',
    totalAssets: '資產合計',
    liabEquityH: '負債及股東權益',
    currentLiabilities: '流動負債',
    totalCurrentLiab: '流動負債合計',
    nonCurrentLiabilities: '非流動負債',
    totalNonCurrentLiab: '非流動負債合計',
    totalLiabilities: '負債合計',
    equity: '股東權益',
    totalEquity: '股東權益合計',
    totalLiabEquity: '負債及股東權益合計',
  },
  en: {
    company: 'BBTruck',
    currency: 'Amounts in New Taiwan Dollars (NTD)',
    is: 'Income Statement',
    bs: 'Balance Sheet',
    ebitda: 'EBITDA Report',
    period: 'Period',
    generated: 'Generated',
    account: 'Account',
    amount: 'Amount',
    current: 'Current',
    previous: 'Previous',
    change: 'Change',
    revenue: 'Revenue',
    totalRevenue: 'Total Revenue',
    cogs: 'Cost of Goods Sold',
    grossProfit: 'Gross Profit',
    opex: 'Operating Expenses',
    totalOpex: 'Total Operating Expenses',
    operatingIncome: 'Operating Income',
    da: '(+) Depreciation & Amortization',
    nonOpIncome: 'Non-operating Income',
    nonOpExpense: 'Non-operating Expense',
    ebt: 'Earnings Before Tax',
    tax: 'Income Tax Expense',
    netIncome: 'Net Income',
    grossMargin: 'Gross Margin',
    opMargin: 'Operating Margin',
    ebitdaMargin: 'EBITDA Margin',
    netMargin: 'Net Margin',
    assetsH: 'ASSETS',
    currentAssets: 'Current Assets',
    totalCurrentAssets: 'Total Current Assets',
    nonCurrentAssets: 'Non-current Assets',
    totalNonCurrentAssets: 'Total Non-current Assets',
    totalAssets: 'Total Assets',
    liabEquityH: "LIABILITIES AND SHAREHOLDERS' EQUITY",
    currentLiabilities: 'Current Liabilities',
    totalCurrentLiab: 'Total Current Liabilities',
    nonCurrentLiabilities: 'Non-current Liabilities',
    totalNonCurrentLiab: 'Total Non-current Liabilities',
    totalLiabilities: 'Total Liabilities',
    equity: "Shareholders' Equity",
    totalEquity: "Total Shareholders' Equity",
    totalLiabEquity: 'Total Liabilities and Equity',
  },
};

module.exports = function(reportEngine) {

  // ===== Company options from middleware =====
  function companyOpts(req) {
    if (!req.company) return {};
    return { companyId: req.company.bcCompanyId, accountsMapping: req.company.accountsMapping };
  }

  // ===== 解析日期參數 =====
  function parseDateParams(query) {
    const { startDate, endDate, year, month, compare = 'none' } = query;

    if (startDate && endDate) {
      return { startDate, endDate, compare };
    }

    if (year && month) {
      const y = Number(year), m = Number(month);
      const s = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const e = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;
      return { startDate: s, endDate: e, compare };
    }

    return null;
  }

  // ===== Dashboard Access Middleware =====
  const { requireDashboard } = require('../middleware/auth');

  // ===== Financial Dashboard =====

  const DashboardService = require('../services/dashboardService');
  const dashService = new DashboardService(reportEngine);

  router.get('/dashboard', requireDashboard('financial'), async (req, res) => {
    try {
      const co = companyOpts(req);
      if (req.query.startDate) co.startDate = req.query.startDate;
      if (req.query.endDate) co.endDate = req.query.endDate;
      const data = await dashService.getDashboardData(co);
      res.json(data);
    } catch (error) {
      console.error('[API] Dashboard error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Sales Dashboard =====

  const SalesDashboardService = require('../services/salesDashboardService');
  const salesDashService = new SalesDashboardService(reportEngine);

  router.get('/sales-dashboard', requireDashboard('sales'), async (req, res) => {
    try {
      const co = companyOpts(req);
      // Support date filter params
      if (req.query.startDate) co.startDate = req.query.startDate;
      if (req.query.endDate) co.endDate = req.query.endDate;
      const data = await salesDashService.getSalesDashboardData(co);
      res.json(data);
    } catch (error) {
      console.error('[API] Sales Dashboard error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Purchasing Dashboard =====

  const PurchasingDashboardService = require('../services/purchasingDashboardService');
  const purchDashService = new PurchasingDashboardService(reportEngine);

  router.get('/purchasing-dashboard', requireDashboard('purchasing'), async (req, res) => {
    try {
      const co = companyOpts(req);
      if (req.query.startDate) co.startDate = req.query.startDate;
      if (req.query.endDate) co.endDate = req.query.endDate;
      const data = await purchDashService.getPurchasingDashboardData(co);
      res.json(data);
    } catch (error) {
      console.error('[API] Purchasing Dashboard error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Income Statement =====

  router.get('/income-statement', async (req, res) => {
    try {
      const params = parseDateParams(req.query);
      if (!params) return res.status(400).json({ error: 'startDate+endDate or year+month required' });

      const { startDate, endDate, compare } = params;

      const co = companyOpts(req);
      if (compare === 'none') {
        const data = await reportEngine.getIncomeStatementByRange(startDate, endDate, co);
        return res.json({ data, period: { startDate, endDate } });
      }

      const data = await reportEngine.getISComparison(startDate, endDate, compare, co);
      res.json(data);
    } catch (error) {
      console.error('[API] Income Statement error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Balance Sheet =====

  router.get('/balance-sheet', async (req, res) => {
    try {
      const { endDate: ed, year, month, compare = 'none' } = req.query;
      let endDate = ed;

      if (!endDate && year && month) {
        const y = Number(year), m = Number(month);
        const lastDay = new Date(y, m, 0).getDate();
        endDate = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;
      }
      if (!endDate) return res.status(400).json({ error: 'endDate or year+month required' });

      const co = companyOpts(req);
      if (compare === 'none') {
        const data = await reportEngine.getBalanceSheetByDate(endDate, co);
        return res.json({ data, period: { endDate } });
      }

      const data = await reportEngine.getBSComparison(endDate, compare, co);
      res.json(data);
    } catch (error) {
      console.error('[API] Balance Sheet error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== EBITDA (向下相容 LINE Bot) =====

  router.get('/ebitda', async (req, res) => {
    try {
      const { year, month, compare = 'none' } = req.query;
      if (!year || !month) return res.status(400).json({ error: 'year and month required' });

      if (compare === 'none') {
        const data = await reportEngine.getEbitda(Number(year), Number(month));
        return res.json({ data, period: { year: Number(year), month: Number(month) } });
      }
      const data = await reportEngine.getEbitdaComparison(Number(year), Number(month), compare);
      res.json(data);
    } catch (error) {
      console.error('[API] EBITDA error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/ebitda/ytd', async (req, res) => {
    try {
      const { year, month } = req.query;
      if (!year || !month) return res.status(400).json({ error: 'year and month required' });
      const data = await reportEngine.getEbitdaYTD(Number(year), Number(month));
      res.json({ data, period: { year: Number(year), upToMonth: Number(month) } });
    } catch (error) {
      console.error('[API] EBITDA YTD error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Excel Export =====

  router.get('/export/excel', async (req, res) => {
    try {
      const ExcelJS = require('exceljs');
      const { type, view = 'detailed', compare = 'none', lang = 'zh' } = req.query;
      const params = parseDateParams(req.query);
      if (!params) return res.status(400).json({ error: 'Date parameters required' });

      const { startDate, endDate } = params;
      const lb = EXCEL_LABELS[lang] || EXCEL_LABELS.zh;
      const co = companyOpts(req);

      // Use company name if available
      const companyName = req.company
        ? (lang === 'en' ? req.company.nameEn : req.company.name)
        : lb.company;

      // Fetch report data
      let reportData;
      if (type === 'income-statement' || type === 'ebitda') {
        reportData = compare !== 'none'
          ? await reportEngine.getISComparison(startDate, endDate, compare, co)
          : { data: await reportEngine.getIncomeStatementByRange(startDate, endDate, co) };
      } else if (type === 'balance-sheet') {
        reportData = compare !== 'none'
          ? await reportEngine.getBSComparison(endDate, compare, co)
          : { data: await reportEngine.getBalanceSheetByDate(endDate, co) };
      } else {
        return res.status(400).json({ error: 'Invalid report type' });
      }

      const wb = new ExcelJS.Workbook();
      wb.creator = 'BC Financial Reporter';
      wb.created = new Date();

      const ws = wb.addWorksheet('Report');

      // ===== Style definitions =====
      const titleFont = { size: 14, bold: true };
      const headerFont = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
      const sectionFont = { size: 10, bold: true };
      const totalFont = { size: 10, bold: true };
      const totalFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
      const numFmt = '#,##0';
      const pctFmtStr = '0.0%';

      const hasCompare = compare !== 'none';
      const report = hasCompare ? reportData.current : reportData.data;
      const prev = hasCompare ? reportData.previous : null;

      // Title rows
      ws.addRow([companyName]);
      ws.getRow(1).font = titleFont;
      ws.mergeCells(1, 1, 1, hasCompare ? 4 : 2);

      const reportNames = {
        'income-statement': lb.is,
        'balance-sheet': lb.bs,
        'ebitda': lb.ebitda,
      };
      ws.addRow([reportNames[type] || type]);
      ws.getRow(2).font = { size: 11, bold: true };

      ws.addRow([lb.currency]);
      ws.getRow(3).font = { size: 9, color: { argb: 'FF888888' } };

      ws.addRow([`${lb.period}：${startDate} ~ ${endDate}`]);
      ws.getRow(4).font = { size: 9, color: { argb: 'FF888888' } };

      ws.addRow([`${lb.generated}：${new Date().toLocaleString(lang === 'zh' ? 'zh-TW' : 'en-US')}`]);
      ws.getRow(5).font = { size: 9, color: { argb: 'FF888888' } };
      ws.addRow([]);

      // Column widths
      ws.getColumn(1).width = 40;
      ws.getColumn(2).width = 18;
      if (hasCompare) { ws.getColumn(3).width = 18; ws.getColumn(4).width = 18; }

      // Header row
      const headers = hasCompare ? [lb.account, lb.current, lb.previous, lb.change] : [lb.account, lb.amount];
      const hdrRow = ws.addRow(headers);
      hdrRow.eachCell(c => { c.font = headerFont; c.fill = headerFill; c.alignment = { horizontal: 'center' }; });

      // ===== Build rows =====
      if (type === 'income-statement' || type === 'ebitda') {
        const sec = report.sections;
        const prevSec = prev?.sections;
        const s = report.summary;
        const ps = prev?.summary;

        const addSection = (label, section, prevSection, field, negate) => {
          const sRow = ws.addRow([label]);
          sRow.getCell(1).font = sectionFont;

          if (view === 'detailed' && section?.items) {
            for (const item of section.items) {
              const pi = prevSection?.items?.find(i => i.accountNumber === item.accountNumber);
              const v = negate ? -item.amount : item.amount;
              const pv = pi ? (negate ? -pi.amount : pi.amount) : null;
              const diff = pv != null ? v - pv : null;
              const rowLabel = '  ' + item.accountNumber + ' ' + item.displayName;
              const r = hasCompare ? ws.addRow([rowLabel, v, pv, diff]) : ws.addRow([rowLabel, v]);
              r.getCell(2).numFmt = numFmt;
              if (hasCompare) { r.getCell(3).numFmt = numFmt; r.getCell(4).numFmt = numFmt; }
            }
          } else if (view === 'simple' && section?.items) {
            const groups = {};
            for (const item of section.items) {
              const key = item.subCategory || item.displayName;
              groups[key] = (groups[key] || 0) + item[field];
            }
            const prevGroups = {};
            if (prevSection?.items) {
              for (const item of prevSection.items) {
                const key = item.subCategory || item.displayName;
                prevGroups[key] = (prevGroups[key] || 0) + item[field];
              }
            }
            for (const [name, val] of Object.entries(groups)) {
              if (Math.abs(val) < 0.5) continue;
              const v = negate ? -val : val;
              const pv = prevGroups[name] != null ? (negate ? -prevGroups[name] : prevGroups[name]) : null;
              const diff = pv != null ? v - pv : null;
              const r = hasCompare ? ws.addRow(['  ' + name, v, pv, diff]) : ws.addRow(['  ' + name, v]);
              r.getCell(2).numFmt = numFmt;
              if (hasCompare) { r.getCell(3).numFmt = numFmt; r.getCell(4).numFmt = numFmt; }
            }
          }
        };

        const addTotal = (label, curVal, prevVal) => {
          const diff = prevVal != null ? curVal - prevVal : null;
          const r = hasCompare ? ws.addRow([label, curVal, prevVal, diff]) : ws.addRow([label, curVal]);
          r.eachCell(c => { c.font = totalFont; c.fill = totalFill; });
          r.getCell(2).numFmt = numFmt;
          if (hasCompare) { r.getCell(3).numFmt = numFmt; r.getCell(4).numFmt = numFmt; }
        };

        addSection(lb.revenue, sec.revenue, prevSec?.revenue, 'amount', false);
        addTotal(lb.totalRevenue, s.revenue, ps?.revenue);
        addSection(lb.cogs, sec.cogs, prevSec?.cogs, 'amount', false);
        addTotal(lb.grossProfit, s.grossProfit, ps?.grossProfit);
        ws.addRow([]);
        addSection(lb.opex, sec.operatingExpenses, prevSec?.operatingExpenses, 'amount', false);
        addTotal(lb.totalOpex, s.operatingExpenses, ps?.operatingExpenses);
        addTotal(lb.operatingIncome, s.operatingIncome, ps?.operatingIncome);

        if (type === 'ebitda') {
          ws.addRow([]);
          const daRow = ws.addRow([lb.da, s.depreciation + s.amortization, ps ? ps.depreciation + ps.amortization : null]);
          daRow.getCell(2).numFmt = numFmt;
          addTotal('EBITDA', s.ebitda, ps?.ebitda);

          // EBITDA margins only
          ws.addRow([]);
          ws.addRow([lb.ebitdaMargin, s.ebitdaMargin]).getCell(2).numFmt = pctFmtStr;
          ws.addRow([lb.grossMargin, s.grossMargin]).getCell(2).numFmt = pctFmtStr;
          ws.addRow([lb.opMargin, s.operatingMargin]).getCell(2).numFmt = pctFmtStr;
        } else {
          // Income Statement: continue with non-operating, tax, net income
          ws.addRow([]);
          if (sec.nonOperatingIncome.items.length > 0)
            addSection(lb.nonOpIncome, sec.nonOperatingIncome, prevSec?.nonOperatingIncome, 'amount', false);
          if (sec.nonOperatingExpense.items.length > 0)
            addSection(lb.nonOpExpense, sec.nonOperatingExpense, prevSec?.nonOperatingExpense, 'amount', false);
          addTotal(lb.ebt, s.preTaxIncome, ps?.preTaxIncome);
          ws.addRow(['  ' + lb.tax, s.tax, ps?.tax]);
          addTotal(lb.netIncome, s.netIncome, ps?.netIncome);

          // IS margins
          ws.addRow([]);
          ws.addRow([lb.grossMargin, s.grossMargin]).getCell(2).numFmt = pctFmtStr;
          ws.addRow([lb.opMargin, s.operatingMargin]).getCell(2).numFmt = pctFmtStr;
          ws.addRow([lb.netMargin, s.netMargin]).getCell(2).numFmt = pctFmtStr;
        }

      } else if (type === 'balance-sheet') {
        const sec = report.sections;
        const prevSec = prev?.sections;
        const s = report.summary;
        const ps = prev?.summary;

        const addBSSection = (label, section, prevSection) => {
          const sRow = ws.addRow([label]);
          sRow.getCell(1).font = sectionFont;

          const items = section?.items?.filter(i => Math.abs(i.balance) > 0) || [];
          if (view === 'detailed') {
            for (const item of items) {
              const pi = prevSection?.items?.find(i => i.accountNumber === item.accountNumber);
              const diff = pi ? item.balance - pi.balance : null;
              const r = hasCompare
                ? ws.addRow(['  ' + item.accountNumber + ' ' + item.displayName, item.balance, pi?.balance, diff])
                : ws.addRow(['  ' + item.accountNumber + ' ' + item.displayName, item.balance]);
              r.getCell(2).numFmt = numFmt;
              if (hasCompare) { r.getCell(3).numFmt = numFmt; r.getCell(4).numFmt = numFmt; }
            }
          } else {
            const groups = {};
            for (const item of items) {
              const key = item.subCategory || item.displayName;
              groups[key] = (groups[key] || 0) + item.balance;
            }
            const prevItems = prevSection?.items?.filter(i => Math.abs(i.balance) > 0) || [];
            const prevGroups = {};
            for (const item of prevItems) {
              const key = item.subCategory || item.displayName;
              prevGroups[key] = (prevGroups[key] || 0) + item.balance;
            }
            for (const [name, val] of Object.entries(groups)) {
              if (Math.abs(val) < 0.5) continue;
              const pv = prevGroups[name] ?? null;
              const diff = pv != null ? val - pv : null;
              const r = hasCompare ? ws.addRow(['  ' + name, val, pv, diff]) : ws.addRow(['  ' + name, val]);
              r.getCell(2).numFmt = numFmt;
              if (hasCompare) { r.getCell(3).numFmt = numFmt; r.getCell(4).numFmt = numFmt; }
            }
          }
        };

        const addTotal = (label, curVal, prevVal) => {
          const diff = prevVal != null ? curVal - prevVal : null;
          const r = hasCompare ? ws.addRow([label, curVal, prevVal, diff]) : ws.addRow([label, curVal]);
          r.eachCell(c => { c.font = totalFont; c.fill = totalFill; });
          r.getCell(2).numFmt = numFmt;
          if (hasCompare) { r.getCell(3).numFmt = numFmt; r.getCell(4).numFmt = numFmt; }
        };

        ws.addRow([lb.assetsH]).getCell(1).font = { size: 11, bold: true };
        addBSSection(lb.currentAssets, sec.currentAssets, prevSec?.currentAssets);
        addTotal(lb.totalCurrentAssets, s.currentAssets, ps?.currentAssets);
        addBSSection(lb.nonCurrentAssets, sec.nonCurrentAssets, prevSec?.nonCurrentAssets);
        addTotal(lb.totalNonCurrentAssets, s.nonCurrentAssets, ps?.nonCurrentAssets);
        addTotal(lb.totalAssets, s.totalAssets, ps?.totalAssets);
        ws.addRow([]);
        ws.addRow([lb.liabEquityH]).getCell(1).font = { size: 11, bold: true };
        addBSSection(lb.currentLiabilities, sec.currentLiabilities, prevSec?.currentLiabilities);
        addTotal(lb.totalCurrentLiab, s.currentLiabilities, ps?.currentLiabilities);
        addBSSection(lb.nonCurrentLiabilities, sec.nonCurrentLiabilities, prevSec?.nonCurrentLiabilities);
        addTotal(lb.totalNonCurrentLiab, s.nonCurrentLiabilities, ps?.nonCurrentLiabilities);
        addTotal(lb.totalLiabilities, s.totalLiabilities, ps?.totalLiabilities);
        ws.addRow([]);
        addBSSection(lb.equity, sec.equity, prevSec?.equity);
        addTotal(lb.totalEquity, s.equity, ps?.equity);
        addTotal(lb.totalLiabEquity, s.totalLiabilitiesAndEquity, ps?.totalLiabilitiesAndEquity);
      }

      // Generate and send
      const filename = `${type}_${startDate}_${endDate}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error('[API] Excel export error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Ledger Excel Export =====

  router.get('/export/ledger-excel', requireDashboard('ledger'), async (req, res) => {
    try {
      const ExcelJS = require('exceljs');
      const { mode = 'account', startDate, endDate, accountNumbers: acctParam,
              customerNumber, vendorNumber, open } = req.query;
      const co = companyOpts(req);

      const hFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
      const acctFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF37474F' } };
      const totFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
      const hFont  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      const totFont = { bold: true, size: 10 };
      const numFmt = '#,##0';
      const wb = new ExcelJS.Workbook();
      wb.creator = 'BC Financial Reporter';
      wb.created = new Date();

      const addHeaderRow = (ws, cols) => {
        const r = ws.addRow(cols);
        r.eachCell(c => { c.fill = hFill; c.font = hFont; c.alignment = { vertical: 'middle', wrapText: false }; c.border = { bottom: { style: 'thin', color: { argb: 'FF777777' } } }; });
        r.height = 22;
        return r;
      };

      if (mode === 'account') {
        const accountNumbers = acctParam ? acctParam.split(',').map(s => s.trim()).filter(Boolean) : [];
        const prevDate = subtractOneDay(startDate);
        const [tbOpen, entries] = await Promise.all([
          reportEngine.bc.getTrialBalance(`..${prevDate}`, co).catch(() => []),
          reportEngine.bc.getGeneralLedgerEntries(startDate, endDate, { ...co, accountNumbers, fetchAll: true }),
        ]);
        const openingMap = {};
        (tbOpen || []).forEach(row => {
          openingMap[row.number] = (parseFloat(row.balanceAtDateDebit) || 0) - (parseFloat(row.balanceAtDateCredit) || 0);
        });
        (entries || []).sort((a, b) => {
          if (a.accountNumber !== b.accountNumber) return (a.accountNumber||'').localeCompare(b.accountNumber||'');
          if (a.postingDate !== b.postingDate) return a.postingDate.localeCompare(b.postingDate);
          return (a.entryNumber||0) - (b.entryNumber||0);
        });

        // Group by account
        const groups = new Map();
        (entries || []).forEach(e => {
          const k = e.accountNumber || '';
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(e);
        });

        const ws = wb.addWorksheet('科目餘額表');
        ws.columns = [
          { key: 'date',   width: 14 },
          { key: 'docno',  width: 18 },
          { key: 'desc',   width: 40 },
          { key: 'debit',  width: 14 },
          { key: 'credit', width: 14 },
          { key: 'bal',    width: 16 },
        ];

        // Title
        ws.addRow([`科目餘額表　${startDate} ~ ${endDate}`]);
        ws.getRow(1).font = { bold: true, size: 13 };
        ws.mergeCells(1, 1, 1, 6);
        ws.addRow([]);

        groups.forEach((rows, acctNo) => {
          const opening = openingMap[acctNo] || 0;
          let running = opening;
          let totDr = 0, totCr = 0;

          // Account header
          const acctRow = ws.addRow([`科目：${acctNo}`, '', '', '', '', `期初餘額：${opening.toLocaleString()}`]);
          acctRow.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } }; c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }; });
          ws.mergeCells(acctRow.number, 1, acctRow.number, 5);
          acctRow.height = 22;

          // Column headers
          addHeaderRow(ws, ['過帳日期', '傳票號碼', '說明', '借方', '貸方', '餘額']);

          // Data rows
          rows.forEach((e, i) => {
            const dr = e.debitAmount || 0;
            const cr = e.creditAmount || 0;
            running += dr - cr;
            totDr += dr; totCr += cr;
            const r = ws.addRow([e.postingDate, e.documentNumber, e.description, dr || null, cr || null, running]);
            r.getCell(4).numFmt = numFmt;
            r.getCell(5).numFmt = numFmt;
            r.getCell(6).numFmt = numFmt;
            r.getCell(4).font = { color: { argb: 'FF1565C0' } };
            r.getCell(5).font = { color: { argb: 'FFC62828' } };
            r.getCell(6).font = { bold: true };
            if (i % 2 === 1) r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FB' } }; });
          });

          // Subtotal
          const closing = opening + totDr - totCr;
          const tot = ws.addRow(['本期合計', `共 ${rows.length} 筆`, '', totDr, totCr, `期末：${closing.toLocaleString()}`]);
          tot.eachCell(c => { c.fill = totFill; c.font = totFont; c.border = { top: { style: 'double', color: { argb: 'FF1A1A2E' } } }; });
          tot.getCell(4).numFmt = numFmt;
          tot.getCell(5).numFmt = numFmt;
          ws.addRow([]);
        });

      } else {
        // customer or vendor mode
        const isCustomer = mode === 'customer';
        const openFilter = open !== undefined ? (open === 'true') : undefined;
        const opts = { ...co, startDate, endDate, ...(openFilter !== undefined ? { open: openFilter } : {}), ...(isCustomer ? { customerNumber } : { vendorNumber }) };
        const entries = isCustomer
          ? await reportEngine.bc.getCustomerLedgerEntries(opts)
          : await reportEngine.bc.getVendorLedgerEntries(opts);

        if (!entries) return res.status(404).json({ error: 'Ledger entries API not available' });

        const numKey  = isCustomer ? 'customerNumber' : 'vendorNumber';
        const nameKey = isCustomer ? 'customerName'   : 'vendorName';
        const title   = isCustomer ? '應收帳款明細表' : '應付帳款明細表';

        // Group
        const groups = new Map();
        entries.forEach(e => {
          const k = e[numKey] || '(未知)';
          if (!groups.has(k)) groups.set(k, { name: e[nameKey]||'', rows: [] });
          groups.get(k).rows.push(e);
        });

        // Sheet 1: Summary
        const wsSummary = wb.addWorksheet('彙總');
        wsSummary.columns = [{ width: 14 }, { width: 30 }, { width: 10 }, { width: 16 }];
        wsSummary.addRow([`${title}　${startDate} ~ ${endDate}`]);
        wsSummary.getRow(1).font = { bold: true, size: 13 };
        wsSummary.mergeCells(1, 1, 1, 4);
        wsSummary.addRow([]);
        addHeaderRow(wsSummary, ['編號', '名稱', '筆數', '餘額']);
        let grandTotal = 0;
        groups.forEach((g, num) => {
          const bal = g.rows.reduce((s, r) => s + (r.remainingAmount || r.amount || 0), 0);
          grandTotal += bal;
          const r = wsSummary.addRow([num, g.name, g.rows.length, bal]);
          r.getCell(4).numFmt = numFmt;
          r.getCell(4).font = { color: { argb: bal < 0 ? 'FFC62828' : 'FF1565C0' } };
        });
        const totRow = wsSummary.addRow(['', '合計', '', grandTotal]);
        totRow.eachCell(c => { c.fill = totFill; c.font = totFont; });
        totRow.getCell(4).numFmt = numFmt;

        // Sheet 2: Detail
        const wsDetail = wb.addWorksheet('明細');
        wsDetail.columns = [
          { key: 'num',    width: 14 }, { key: 'name',   width: 24 },
          { key: 'dtype',  width: 14 }, { key: 'docno',  width: 18 },
          { key: 'pdate',  width: 12 }, { key: 'ddate',  width: 12 },
          { key: 'desc',   width: 36 }, { key: 'amt',    width: 14 },
          { key: 'rem',    width: 14 }, { key: 'status', width: 10 },
        ];
        wsDetail.addRow([`${title}　明細　${startDate} ~ ${endDate}`]);
        wsDetail.getRow(1).font = { bold: true, size: 13 };
        wsDetail.mergeCells(1, 1, 1, 10);
        wsDetail.addRow([]);
        addHeaderRow(wsDetail, [isCustomer?'客戶編號':'廠商編號', '名稱', '類型', '單號', '過帳日', '到期日', '說明', '金額', '未結餘額', '狀態']);
        const today = new Date().toISOString().slice(0, 10);
        let rowIdx = 0;
        groups.forEach((g, num) => {
          g.rows.forEach(e => {
            const overdue = e.open && e.dueDate && e.dueDate < today;
            const r = wsDetail.addRow([num, g.name, e.documentType, e.documentNumber, e.postingDate, e.dueDate, e.description, e.amount || null, e.remainingAmount || null, e.open ? '未結清' : '已結清']);
            r.getCell(8).numFmt = numFmt;
            r.getCell(9).numFmt = numFmt;
            if (overdue) { r.getCell(6).font = { color: { argb: 'FFC62828' }, bold: true }; }
            if (rowIdx % 2 === 1) r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FB' } }; });
            rowIdx++;
          });
        });
      }

      const modeLabel = mode === 'account' ? 'balance_detail' : (mode === 'customer' ? 'ar_detail' : 'ap_detail');
      const filename = `${modeLabel}_${startDate}_${endDate}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error('[API] Ledger Excel export error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Ledger / 查帳 API (Read-Only) =====

  router.get('/ledger/gl-entries', requireDashboard('ledger'), async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });

      const co = companyOpts(req);
      // 支援多科目篩選: accountNumbers=1100,1150,4100
      const accountNumbers = req.query.accountNumbers
        ? req.query.accountNumbers.split(',').map(s => s.trim()).filter(Boolean)
        : [];

      const entries = await reportEngine.bc.getGeneralLedgerEntries(startDate, endDate, {
        ...co,
        accountNumbers,
        fetchAll: true,
      });

      res.json({ data: entries, count: entries.length });
    } catch (error) {
      console.error('[API] GL Entries error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/ledger/trial-balance', requireDashboard('ledger'), async (req, res) => {
    try {
      const { dateFilter } = req.query; // format: YYYY-MM-DD..YYYY-MM-DD
      const co = companyOpts(req);
      const data = await reportEngine.bc.getTrialBalance(dateFilter || undefined, co);
      res.json({ data: data || [] });
    } catch (error) {
      console.error('[API] Trial Balance error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/ledger/journals', requireDashboard('ledger'), async (req, res) => {
    try {
      const co = companyOpts(req);
      const journals = await reportEngine.bc.getJournals(co);
      res.json({ data: journals || [] });
    } catch (error) {
      console.error('[API] Journals error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/ledger/journals/:journalId/lines', requireDashboard('ledger'), async (req, res) => {
    try {
      const co = companyOpts(req);
      const lines = await reportEngine.bc.getJournalLines(req.params.journalId, co);
      res.json({ data: lines || [] });
    } catch (error) {
      console.error('[API] Journal Lines error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/ledger/customer-payment-journals', requireDashboard('ledger'), async (req, res) => {
    try {
      const co = companyOpts(req);
      const data = await reportEngine.bc.getCustomerPaymentJournals(co);
      res.json({ data: data || [] });
    } catch (error) {
      console.error('[API] Customer Payment Journals error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/ledger/vendor-payment-journals', requireDashboard('ledger'), async (req, res) => {
    try {
      const co = companyOpts(req);
      const data = await reportEngine.bc.getVendorPaymentJournals(co);
      res.json({ data: data || [] });
    } catch (error) {
      console.error('[API] Vendor Payment Journals error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/ledger/item-ledger-entries', requireDashboard('ledger'), async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const co = companyOpts(req);
      const data = await reportEngine.bc.getItemLedgerEntries(startDate, endDate, co);
      res.json({ data: data || [] });
    } catch (error) {
      console.error('[API] Item Ledger Entries error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== 科目餘額表 (Account Balance Detail) =====

  // Helper: subtract one day from a YYYY-MM-DD string
  function subtractOneDay(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split('T')[0];
  }

  /**
   * 科目餘額表 — 科目模式
   * Returns GL entries for period + opening balances from trial balance
   * GET /api/ledger/balance-detail?startDate=&endDate=&accountNumbers=
   */
  router.get('/ledger/balance-detail', requireDashboard('ledger'), async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });

      const co = companyOpts(req);
      const accountNumbers = req.query.accountNumbers
        ? req.query.accountNumbers.split(',').map(s => s.trim()).filter(Boolean)
        : [];

      const prevDate = subtractOneDay(startDate);

      // Parallel: opening balance snapshot + period entries (sorted asc for running balance)
      const [tbOpen, entries] = await Promise.all([
        reportEngine.bc.getTrialBalance(`..${prevDate}`, co).catch(() => []),
        reportEngine.bc.getGeneralLedgerEntries(startDate, endDate, {
          ...co,
          accountNumbers,
          fetchAll: true,
        }),
      ]);

      // Build opening balance map: accountNumber → signed balance (debit-credit)
      const openingBalances = {};
      (tbOpen || []).forEach(row => {
        const d = parseFloat(row.balanceAtDateDebit) || 0;
        const c = parseFloat(row.balanceAtDateCredit) || 0;
        openingBalances[row.number] = d - c;
      });

      // Sort entries by accountNumber asc, then postingDate asc, entryNumber asc
      (entries || []).sort((a, b) => {
        if (a.accountNumber !== b.accountNumber) return (a.accountNumber || '').localeCompare(b.accountNumber || '');
        if (a.postingDate !== b.postingDate) return a.postingDate.localeCompare(b.postingDate);
        return (a.entryNumber || 0) - (b.entryNumber || 0);
      });

      res.json({ data: entries || [], openingBalances });
    } catch (error) {
      console.error('[API] Balance Detail error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 科目餘額表 — 客戶模式
   * GET /api/ledger/customer-ledger?startDate=&endDate=&customerNumber=&open=
   */
  router.get('/ledger/customer-ledger', requireDashboard('ledger'), async (req, res) => {
    try {
      const { startDate, endDate, customerNumber, open, agedAsOfDate, periodLength, view } = req.query;
      const co = companyOpts(req);

      // view=invoices → force salesInvoices+creditMemos ledger view (running balance, 沖帳)
      // view=aged → try ledgerEntries → agedAR → invoices
      if (view === 'invoices') {
        const openBool = open === 'true' ? true : open === 'false' ? false : undefined;
        // Fetch period entries + opening (entries with postingDate < startDate, ALL statuses)
        const prevDate = startDate ? subtractOneDay(startDate) : null;
        const [siData, prePeriod] = await Promise.all([
          reportEngine.bc.getCustomerLedgerFromInvoices({ ...co, startDate, endDate, customerNumber, open: openBool }),
          prevDate ? reportEngine.bc.getCustomerLedgerFromInvoices({ ...co, endDate: prevDate, customerNumber }) : Promise.resolve([]),
        ]);
        // Compute opening balance per customer: sum invoices - sum creditMemos
        const openingByEntity = {};
        (prePeriod || []).forEach(e => {
          const k = e.customerNumber || '';
          if (!openingByEntity[k]) openingByEntity[k] = 0;
          const amt = e.totalAmountIncludingTax || 0;
          openingByEntity[k] += e._type === 'creditMemo' ? -amt : amt;
        });
        if (!siData || siData.length === 0) {
          // Tier 2: try aged
          const agedOpts = { ...co, agedAsOfDate: agedAsOfDate || endDate, periodLengthFilter: periodLength || '30D' };
          const agedData = await reportEngine.bc.getAgedAccountsReceivable(agedOpts);
          if (agedData && agedData.length > 0) {
            const filtered = customerNumber ? agedData.filter(r => r.customerNumber === customerNumber) : agedData;
            return res.json({ data: filtered, source: 'agedReceivable', autoFallback: true });
          }
          // Tier 3: GL on AR accounts
          const arAccounts = await reportEngine.bc.getPostingAccountsBySubCategory('應收帳款', co);
          if (arAccounts && arAccounts.length > 0) {
            const acctNums = arAccounts.map(a => a.number);
            const glEntries = await reportEngine.bc.getGeneralLedgerEntries(startDate, endDate, { ...co, accountNumbers: acctNums, fetchAll: true });
            // Compute opening balances per AR account
            const prevDate = startDate ? subtractOneDay(startDate) : null;
            const openingBalances = {};
            if (prevDate) {
              const tbOpen = await reportEngine.bc.getTrialBalance(`..${prevDate}`, co).catch(() => []);
              (tbOpen || []).forEach(row => {
                if (acctNums.includes(row.number)) {
                  openingBalances[row.number] = (parseFloat(row.balanceAtDateDebit)||0) - (parseFloat(row.balanceAtDateCredit)||0);
                }
              });
            }
            (glEntries || []).sort((a,b) => (a.accountNumber||'').localeCompare(b.accountNumber||'') || (a.postingDate||'').localeCompare(b.postingDate||'') || (a.entryNumber||0)-(b.entryNumber||0));
            return res.json({ data: glEntries || [], source: 'glReceivable', openingBalances, autoFallback: true, arAccounts: arAccounts.map(a => ({ number: a.number, displayName: a.displayName })) });
          }
        }
        return res.json({ data: siData || [], source: 'salesInvoices', openingByEntity });
      }

      // Try customerLedgerEntries first (requires Web Service publish)
      const ledgerOpts = { ...co, startDate, endDate, customerNumber, ...(open !== undefined ? { open: open === 'true' } : {}) };
      let data = await reportEngine.bc.getCustomerLedgerEntries(ledgerOpts);
      if (data !== null) return res.json({ data, source: 'ledgerEntries' });

      // Fallback: agedAccountsReceivables (plural — works on standard BC v2.0)
      const agedOpts = { ...co, agedAsOfDate: agedAsOfDate || endDate, periodLengthFilter: periodLength || '30D' };
      const agedData = await reportEngine.bc.getAgedAccountsReceivable(agedOpts);
      if (agedData !== null) {
        const filtered = customerNumber ? agedData.filter(r => r.customerNumber === customerNumber) : agedData;
        return res.json({ data: filtered, source: 'agedReceivable' });
      }

      // Final fallback: salesInvoices + salesCreditMemos
      const openBool = open === 'true' ? true : open === 'false' ? false : undefined;
      const siData = await reportEngine.bc.getCustomerLedgerFromInvoices({ ...co, startDate, endDate, customerNumber, open: openBool });
      res.json({ data: siData || [], source: 'salesInvoices' });
    } catch (error) {
      console.error('[API] Customer Ledger error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 科目餘額表 — 廠商模式
   * GET /api/ledger/vendor-ledger?startDate=&endDate=&vendorNumber=&open=
   */
  router.get('/ledger/vendor-ledger', requireDashboard('ledger'), async (req, res) => {
    try {
      const { startDate, endDate, vendorNumber, open, agedAsOfDate, periodLength, view } = req.query;
      const co = companyOpts(req);

      if (view === 'invoices') {
        const openBool = open === 'true' ? true : open === 'false' ? false : undefined;
        const prevDate = startDate ? subtractOneDay(startDate) : null;
        const [piData, prePeriod] = await Promise.all([
          reportEngine.bc.getVendorLedgerFromInvoices({ ...co, startDate, endDate, vendorNumber, open: openBool }),
          prevDate ? reportEngine.bc.getVendorLedgerFromInvoices({ ...co, endDate: prevDate, vendorNumber }) : Promise.resolve([]),
        ]);
        const openingByEntity = {};
        (prePeriod || []).forEach(e => {
          const k = e.vendorNumber || '';
          if (!openingByEntity[k]) openingByEntity[k] = 0;
          const amt = e.totalAmountIncludingTax || 0;
          openingByEntity[k] += e._type === 'creditMemo' ? -amt : amt;
        });
        // Auto-fallback chain: aged → GL
        if (!piData || piData.length === 0) {
          const agedOpts = { ...co, agedAsOfDate: agedAsOfDate || endDate, periodLengthFilter: periodLength || '30D' };
          const agedData = await reportEngine.bc.getAgedAccountsPayable(agedOpts);
          if (agedData && agedData.length > 0) {
            const filtered = vendorNumber ? agedData.filter(r => r.vendorNumber === vendorNumber) : agedData;
            return res.json({ data: filtered, source: 'agedPayable', autoFallback: true });
          }
          // Tier 3: GL on AP accounts (217101 應付帳款-廠商, 217102 應付帳款-員工, 218101 應付帳款-關係人 etc.)
          const apAccounts = await reportEngine.bc.getPostingAccountsBySubCategory('應付帳款', co);
          if (apAccounts && apAccounts.length > 0) {
            const acctNums = apAccounts.map(a => a.number);
            const glEntries = await reportEngine.bc.getGeneralLedgerEntries(startDate, endDate, { ...co, accountNumbers: acctNums, fetchAll: true });
            const prevDate = startDate ? subtractOneDay(startDate) : null;
            const openingBalances = {};
            if (prevDate) {
              const tbOpen = await reportEngine.bc.getTrialBalance(`..${prevDate}`, co).catch(() => []);
              (tbOpen || []).forEach(row => {
                if (acctNums.includes(row.number)) {
                  openingBalances[row.number] = (parseFloat(row.balanceAtDateDebit)||0) - (parseFloat(row.balanceAtDateCredit)||0);
                }
              });
            }
            (glEntries || []).sort((a,b) => (a.accountNumber||'').localeCompare(b.accountNumber||'') || (a.postingDate||'').localeCompare(b.postingDate||'') || (a.entryNumber||0)-(b.entryNumber||0));
            return res.json({ data: glEntries || [], source: 'glPayable', openingBalances, autoFallback: true, apAccounts: apAccounts.map(a => ({ number: a.number, displayName: a.displayName })) });
          }
        }
        return res.json({ data: piData || [], source: 'purchaseInvoices', openingByEntity });
      }

      const ledgerOpts = { ...co, startDate, endDate, vendorNumber, ...(open !== undefined ? { open: open === 'true' } : {}) };
      let data = await reportEngine.bc.getVendorLedgerEntries(ledgerOpts);
      if (data !== null) return res.json({ data, source: 'ledgerEntries' });

      // Fallback: agedAccountsPayables (plural)
      const agedOpts = { ...co, agedAsOfDate: agedAsOfDate || endDate, periodLengthFilter: periodLength || '30D' };
      const agedData = await reportEngine.bc.getAgedAccountsPayable(agedOpts);
      if (agedData !== null) {
        const filtered = vendorNumber ? agedData.filter(r => r.vendorNumber === vendorNumber) : agedData;
        return res.json({ data: filtered, source: 'agedPayable' });
      }

      const openBool = open === 'true' ? true : open === 'false' ? false : undefined;
      const piData = await reportEngine.bc.getVendorLedgerFromInvoices({ ...co, startDate, endDate, vendorNumber, open: openBool });
      res.json({ data: piData || [], source: 'purchaseInvoices' });
    } catch (error) {
      console.error('[API] Vendor Ledger error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 維度值清單 (for 關係人 selector)
   * GET /api/ledger/dimension-values?dimensionCode=關係人&companyId=
   */
  router.get('/ledger/dimension-values', requireDashboard('ledger'), async (req, res) => {
    try {
      const { dimensionCode } = req.query;
      if (!dimensionCode) return res.status(400).json({ error: 'dimensionCode required' });
      const co = companyOpts(req);
      const data = await reportEngine.bc.getDimensionValues(dimensionCode, co);
      res.json({ data: data || [] });
    } catch (error) {
      console.error('[API] DimensionValues error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 關係人交易明細
   * GET /api/ledger/related-party?dimValue=&startDate=&endDate=&companyId=
   */
  router.get('/ledger/related-party', requireDashboard('ledger'), async (req, res) => {
    try {
      const { dimValue, startDate, endDate } = req.query;
      const co = companyOpts(req);
      const data = await reportEngine.bc.getGLEntriesByDimension(dimValue || null, { ...co, startDate, endDate });
      res.json({ data: data || [] });
    } catch (error) {
      console.error('[API] Related Party error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 客戶清單 (for selector)
   * GET /api/customers-list
   */
  router.get('/customers-list', requireDashboard('ledger'), async (req, res) => {
    try {
      const co = companyOpts(req);
      const data = await reportEngine.bc.getCustomers(co);
      res.json({ data: data || [] });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 廠商清單 (for selector)
   * GET /api/vendors-list
   */
  router.get('/vendors-list', requireDashboard('ledger'), async (req, res) => {
    try {
      const co = companyOpts(req);
      const data = await reportEngine.bc.getVendors(co);
      res.json({ data: data || [] });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Accounts =====

  router.get('/accounts', async (req, res) => {
    try {
      const co = companyOpts(req);
      const data = await reportEngine.bc.getAccounts(co);
      res.json({ data });
    } catch (error) {
      console.error('[API] Accounts error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Config =====

  router.get('/config/accounts-mapping', (req, res) => {
    const mapping = require('../../config/accounts-mapping.json');
    res.json(mapping);
  });

  router.put('/config/accounts-mapping', async (req, res) => {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const newMapping = req.body;
      const requiredKeys = ['revenue', 'cogs', 'operating_expenses', 'depreciation', 'amortization', 'interest_expense', 'tax_expense'];
      for (const key of requiredKeys) {
        if (!Array.isArray(newMapping[key])) return res.status(400).json({ error: `Missing or invalid key: ${key}` });
      }
      const configPath = path.join(__dirname, '../../config/accounts-mapping.json');
      await fs.writeFile(configPath, JSON.stringify(newMapping, null, 2));
      reportEngine.cache.clear();
      res.json({ message: 'Accounts mapping updated', data: newMapping });
    } catch (error) {
      console.error('[API] Config update error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
