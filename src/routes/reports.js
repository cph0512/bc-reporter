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

  // ===== Export permission helper =====
  function canExport(req) {
    const u = req.session?.user;
    if (!u) return false;
    if (u.role === 'admin') return true;
    return u.canExport === true;
  }

  // ===== Excel Export =====

  router.get('/export/excel', async (req, res) => {
    if (!canExport(req)) return res.status(403).json({ error: '您沒有匯出權限，請聯絡管理員' });
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

  // ===== Expense Comparison =====

  router.get('/expense-comparison', requireDashboard('reports'), async (req, res) => {
    try {
      const { mode, companyId: qcid } = req.query;
      const co = companyOpts(req);

      let periods = [];

      if (req.query.custom) {
        periods = req.query.custom.split(';').map(seg => {
          const [startDate, endDate, label] = seg.split(',');
          return { startDate, endDate, label: label || `${startDate} ~ ${endDate}` };
        });
      } else if (mode === 'yoy') {
        const years = [].concat(req.query.periods || []).map(Number).sort();
        if (years.length < 2) return res.status(400).json({ error: 'At least 2 years required' });
        periods = years.map(y => ({
          startDate: `${y}-01-01`,
          endDate: `${y}-12-31`,
          label: `${y}`,
        }));
      } else {
        const months = [].concat(req.query.periods || []).sort();
        if (months.length < 2) return res.status(400).json({ error: 'At least 2 periods required' });
        periods = months.map(m => {
          const [y, mon] = m.split('-').map(Number);
          const lastDay = new Date(y, mon, 0).getDate();
          return {
            startDate: `${y}-${String(mon).padStart(2, '0')}-01`,
            endDate: `${y}-${String(mon).padStart(2, '0')}-${lastDay}`,
            label: `${y}/${mon}`,
          };
        });
      }

      const expenseRange = req.query.range || '510100-631038';
      if (req.query.department) co.department = req.query.department;
      const data = await reportEngine.getExpenseComparison(periods, expenseRange, co);
      res.json(data);
    } catch (error) {
      console.error('[API] Expense Comparison error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Sales Comparison =====

  router.get('/sales-comparison', requireDashboard('reports'), async (req, res) => {
    try {
      const { mode } = req.query;
      const co = companyOpts(req);

      let periods = [];

      if (req.query.custom) {
        periods = req.query.custom.split(';').map(seg => {
          const [startDate, endDate, label] = seg.split(',');
          return { startDate, endDate, label: label || `${startDate} ~ ${endDate}` };
        });
      } else if (mode === 'yoy') {
        const years = [].concat(req.query.periods || []).map(Number).sort();
        if (years.length < 2) return res.status(400).json({ error: 'At least 2 years required' });
        periods = years.map(y => ({
          startDate: `${y}-01-01`,
          endDate: `${y}-12-31`,
          label: `${y}`,
        }));
      } else {
        const months = [].concat(req.query.periods || []).sort();
        if (months.length < 2) return res.status(400).json({ error: 'At least 2 periods required' });
        periods = months.map(m => {
          const [y, mon] = m.split('-').map(Number);
          const lastDay = new Date(y, mon, 0).getDate();
          return {
            startDate: `${y}-${String(mon).padStart(2, '0')}-01`,
            endDate: `${y}-${String(mon).padStart(2, '0')}-${lastDay}`,
            label: `${y}/${mon}`,
          };
        });
      }

      const accounts = (req.query.accounts || '411111,411112,411113').split(',').map(s => s.trim());
      if (req.query.department) co.department = req.query.department;
      const data = await reportEngine.getSalesComparison(periods, accounts, co);
      res.json(data);
    } catch (error) {
      console.error('[API] Sales Comparison error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Departments (部門列表) =====

  router.get('/departments', requireDashboard('reports'), async (req, res) => {
    try {
      const co = companyOpts(req);
      const departments = await reportEngine.getDepartments(co);
      res.json(departments);
    } catch (error) {
      console.error('[API] Departments error:', error.message);
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

  // ===== Ledger Excel Export =====

  router.get('/export/ledger/excel', requireDashboard('ledger'), async (req, res) => {
    if (!canExport(req)) return res.status(403).json({ error: '您沒有匯出權限，請聯絡管理員' });
    try {
      const ExcelJS = require('exceljs');
      const { type, dateFilter, startDate, endDate, accountNumbers, lang = 'zh', companyId } = req.query;
      const co = companyOpts(req);
      const isEn = lang === 'en';

      const wb = new ExcelJS.Workbook();
      wb.creator = 'BC Financial Reporter';
      wb.created = new Date();

      const headerFont = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
      const titleFont = { size: 13, bold: true };
      const numFmt = '#,##0';

      // Company name
      const companyStore = require('../services/companyStore');
      const allCos = companyStore.getAll();
      const coObj = allCos.find(c => c.id === (companyId || co.companyId));
      const companyName = coObj ? (isEn ? coObj.nameEn : coObj.name) : '';

      if (type === 'trial-balance') {
        const data = await reportEngine.bc.getTrialBalance(dateFilter || undefined, co);
        const ws = wb.addWorksheet(isEn ? 'Trial Balance' : '試算表');

        // Title
        ws.addRow([companyName]);
        ws.getRow(1).font = titleFont;
        ws.addRow([isEn ? 'Trial Balance' : '試算表']);
        ws.getRow(2).font = { size: 11, bold: true };
        if (dateFilter) ws.addRow([`${isEn ? 'Period' : '期間'}：${dateFilter.replace('..', ' ~ ')}`]);
        ws.addRow([`${isEn ? 'Generated' : '產出時間'}：${new Date().toLocaleString(isEn ? 'en-US' : 'zh-TW')}`]);
        ws.addRow([]);

        // Columns
        ws.getColumn(1).width = 12;
        ws.getColumn(2).width = 35;
        ws.getColumn(3).width = 20;
        ws.getColumn(4).width = 18;
        ws.getColumn(5).width = 18;

        // Header
        const hdr = ws.addRow([
          isEn ? 'Account No.' : '科目編號',
          isEn ? 'Account Name' : '科目名稱',
          isEn ? 'Category' : '分類',
          isEn ? 'Net Change' : '本期發生額',
          isEn ? 'Balance' : '期末餘額',
        ]);
        hdr.eachCell(c => { c.font = headerFont; c.fill = headerFill; c.alignment = { horizontal: 'center' }; });

        // Data rows (sorted by account number)
        const sorted = [...(data || [])].sort((a, b) => (a.number || '').localeCompare(b.number || ''));
        let totalNC = 0, totalBal = 0;
        sorted.forEach((row, i) => {
          const nc = row.netChange || 0;
          const bal = row.balance || 0;
          totalNC += nc; totalBal += bal;
          const r = ws.addRow([
            row.number || '',
            row.displayName || row.name || '',
            row.accountCategory || '',
            nc, bal,
          ]);
          r.getCell(4).numFmt = numFmt;
          r.getCell(5).numFmt = numFmt;
          if (i % 2 !== 0) r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
        });

        // Total row
        const totalRow = ws.addRow([isEn ? 'Total' : '合計', '', '', totalNC, totalBal]);
        totalRow.font = { bold: true };
        totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
        totalRow.getCell(4).numFmt = numFmt;
        totalRow.getCell(5).numFmt = numFmt;

        const filename = `trial-balance_${dateFilter || 'all'}_${companyId || ''}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await wb.xlsx.write(res);
        return res.end();

      } else if (type === 'gl-entries') {
        if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });
        const accts = accountNumbers ? accountNumbers.split(',').map(s => s.trim()).filter(Boolean) : [];
        const entries = await reportEngine.bc.getGeneralLedgerEntries(startDate, endDate, { ...co, accountNumbers: accts, fetchAll: true });
        const ws = wb.addWorksheet(isEn ? 'GL Entries' : '總帳分錄');

        ws.addRow([companyName]);
        ws.getRow(1).font = titleFont;
        ws.addRow([isEn ? 'General Ledger Entries' : '總帳分錄']);
        ws.getRow(2).font = { size: 11, bold: true };
        ws.addRow([`${isEn ? 'Period' : '期間'}：${startDate} ~ ${endDate}`]);
        ws.addRow([`${isEn ? 'Generated' : '產出時間'}：${new Date().toLocaleString(isEn ? 'en-US' : 'zh-TW')}`]);
        ws.addRow([]);

        ws.getColumn(1).width = 12;
        ws.getColumn(2).width = 12;
        ws.getColumn(3).width = 35;
        ws.getColumn(4).width = 30;
        ws.getColumn(5).width = 16;
        ws.getColumn(6).width = 16;

        const hdr = ws.addRow([
          isEn ? 'Account No.' : '科目編號',
          isEn ? 'Date' : '日期',
          isEn ? 'Account Name' : '科目名稱',
          isEn ? 'Description' : '說明',
          isEn ? 'Debit' : '借方',
          isEn ? 'Credit' : '貸方',
        ]);
        hdr.eachCell(c => { c.font = headerFont; c.fill = headerFill; c.alignment = { horizontal: 'center' }; });

        let totalDebit = 0, totalCredit = 0;
        (entries || []).forEach((e, i) => {
          const d = e.debitAmount || 0;
          const cr = e.creditAmount || 0;
          totalDebit += d; totalCredit += cr;
          const r = ws.addRow([
            e.accountNumber || '',
            e.postingDate || '',
            e.accountName || e.displayName || '',
            e.description || '',
            d, cr,
          ]);
          r.getCell(5).numFmt = numFmt;
          r.getCell(6).numFmt = numFmt;
          if (i % 2 !== 0) r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
        });

        const totalRow = ws.addRow([isEn ? 'Total' : '合計', '', '', '', totalDebit, totalCredit]);
        totalRow.font = { bold: true };
        totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
        totalRow.getCell(5).numFmt = numFmt;
        totalRow.getCell(6).numFmt = numFmt;

        const filename = `gl-entries_${startDate}_${endDate}_${companyId || ''}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await wb.xlsx.write(res);
        return res.end();

      } else {
        return res.status(400).json({ error: 'type must be trial-balance or gl-entries' });
      }
    } catch (error) {
      console.error('[API] Ledger Excel export error:', error.message);
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
