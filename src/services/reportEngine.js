// src/services/reportEngine.js
// 報表引擎 — 從 GL Entries + Chart of Accounts 建構所有財務報表
// 支援日期範圍查詢（月/季/半年/年/自訂）

const BCClient = require('./bcClient');
const fs = require('fs');
const path = require('path');

class ReportEngine {
  constructor(bcClient) {
    this.bc = bcClient;
    this.cache = new Map();
    this.cacheTTL = 10 * 60 * 1000; // 10 minutes
  }

  // ===== Config =====

  getAccountsMapping(mappingFile) {
    const filename = mappingFile || 'accounts-mapping.json';
    const configPath = path.join(__dirname, '../../config', filename);
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  // ===== Cache Helper =====

  getCacheKey(...parts) {
    return parts.join(':');
  }

  getFromCache(key) {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.cacheTTL) {
      return entry.data;
    }
    this.cache.delete(key);
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  // ===== Date Range Helper =====

  /**
   * 計算比較期間
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @param {string} compareType - yoy | mom | qoq
   * @returns {{ startDate: string, endDate: string }}
   */
  getComparisonRange(startDate, endDate, compareType) {
    const s = new Date(startDate + 'T00:00:00');
    const e = new Date(endDate + 'T00:00:00');

    let shift;
    if (compareType === 'yoy') shift = 12;
    else if (compareType === 'qoq') shift = 3;
    else shift = 1; // mom

    const ps = new Date(s);
    ps.setMonth(ps.getMonth() - shift);
    const pe = new Date(e);
    pe.setMonth(pe.getMonth() - shift);

    return {
      startDate: this.fmtDate(ps),
      endDate: this.fmtDate(pe),
    };
  }

  fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ===== 損益表 (Income Statement) — 日期範圍版 =====

  async getIncomeStatementByRange(startDate, endDate, opts = {}) {
    const cid = opts.companyId;
    const cacheKey = this.getCacheKey('is', startDate, endDate, cid || 'default');
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const [glEntries, accountsMap] = await Promise.all([
      this.bc.getGeneralLedgerEntries(startDate, endDate, { fetchAll: true, companyId: cid }),
      this.bc.getAccountsMap({ companyId: cid }),
    ]);

    const period = { startDate, endDate };
    const result = this.buildIncomeStatement(glEntries, accountsMap, period, opts.accountsMapping);
    this.setCache(cacheKey, result);
    return result;
  }

  // 向下相容：年/月版
  async getIncomeStatement(year, month) {
    const { start, end } = BCClient.getMonthRange(year, month);
    return this.getIncomeStatementByRange(start, end);
  }

  buildIncomeStatement(glEntries, accountsMap, period, mappingFile) {
    const sections = {
      revenue: { label: '營業收入', items: [], total: 0 },
      cogs: { label: '營業成本', items: [], total: 0 },
      grossProfit: { label: '營業毛利', total: 0 },
      operatingExpenses: { label: '營業費用', items: [], total: 0 },
      operatingIncome: { label: '營業利益', total: 0 },
      nonOperatingIncome: { label: '營業外收入', items: [], total: 0 },
      nonOperatingExpense: { label: '營業外費用', items: [], total: 0 },
      preTaxIncome: { label: '稅前淨利', total: 0 },
      tax: { label: '所得稅費用', items: [], total: 0 },
      netIncome: { label: '稅後淨利', total: 0 },
    };

    const accountTotals = {};
    for (const entry of glEntries) {
      const accNum = entry.accountNumber;
      if (!accountTotals[accNum]) accountTotals[accNum] = { debit: 0, credit: 0 };
      accountTotals[accNum].debit += entry.debitAmount || 0;
      accountTotals[accNum].credit += entry.creditAmount || 0;
    }

    const mapping = this.getAccountsMapping(mappingFile);

    for (const [accNum, totals] of Object.entries(accountTotals)) {
      const info = accountsMap[accNum];
      if (!info || info.accountType !== 'Posting') continue;

      const netAmount = totals.debit - totals.credit;
      const item = {
        accountNumber: accNum,
        displayName: info.displayName,
        subCategory: info.subCategory || '',
        amount: netAmount,
      };

      const cat = info.category;

      if (cat === 'Income') {
        if (this.inRange(accNum, mapping.revenue || [])) {
          item.amount = Math.abs(netAmount);
          sections.revenue.items.push(item);
          sections.revenue.total += item.amount;
        } else if (this.inRange(accNum, mapping.non_operating_income || [])) {
          item.amount = totals.credit - totals.debit;
          sections.nonOperatingIncome.items.push(item);
          sections.nonOperatingIncome.total += item.amount;
        } else {
          item.amount = totals.credit - totals.debit;
          sections.nonOperatingIncome.items.push(item);
          sections.nonOperatingIncome.total += item.amount;
        }
      } else if (cat === 'Cost_x0020_of_x0020_Goods_x0020_Sold') {
        item.amount = Math.abs(netAmount);
        sections.cogs.items.push(item);
        sections.cogs.total += item.amount;
      } else if (cat === 'Expense') {
        item.amount = Math.abs(netAmount);
        if (this.inRange(accNum, mapping.tax_expense || [])) {
          sections.tax.items.push(item);
          sections.tax.total += item.amount;
        } else if (this.inRange(accNum, mapping.non_operating_expense || [])) {
          sections.nonOperatingExpense.items.push(item);
          sections.nonOperatingExpense.total += item.amount;
        } else {
          sections.operatingExpenses.items.push(item);
          sections.operatingExpenses.total += item.amount;
        }
      }
    }

    // Calculate derived totals
    sections.grossProfit.total = sections.revenue.total - sections.cogs.total;
    sections.operatingIncome.total = sections.grossProfit.total - sections.operatingExpenses.total;
    sections.preTaxIncome.total = sections.operatingIncome.total
      + sections.nonOperatingIncome.total - sections.nonOperatingExpense.total;
    sections.netIncome.total = sections.preTaxIncome.total - sections.tax.total;

    // Flag D&A items and compute EBITDA
    let depreciationTotal = 0;
    let amortizationTotal = 0;
    for (const item of sections.operatingExpenses.items) {
      if (this.inRange(item.accountNumber, mapping.depreciation || [])) {
        item.isDA = true;
        depreciationTotal += item.amount;
      }
      if (this.inRange(item.accountNumber, mapping.amortization || [])) {
        item.isDA = true;
        amortizationTotal += item.amount;
      }
    }
    const ebitda = sections.operatingIncome.total + depreciationTotal + amortizationTotal;

    // Flag interest expense items
    for (const item of sections.nonOperatingExpense.items) {
      if (this.inRange(item.accountNumber, mapping.interest_expense || [])) {
        item.isInterest = true;
      }
    }

    // Sort items by account number
    for (const section of Object.values(sections)) {
      if (section.items) {
        section.items.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
      }
    }

    const rev = sections.revenue.total;
    return {
      period,
      sections,
      summary: {
        revenue: rev,
        cogs: sections.cogs.total,
        grossProfit: sections.grossProfit.total,
        grossMargin: rev > 0 ? sections.grossProfit.total / rev : 0,
        operatingExpenses: sections.operatingExpenses.total,
        operatingIncome: sections.operatingIncome.total,
        operatingMargin: rev > 0 ? sections.operatingIncome.total / rev : 0,
        depreciation: depreciationTotal,
        amortization: amortizationTotal,
        ebitda,
        ebitdaMargin: rev > 0 ? ebitda / rev : 0,
        nonOperatingIncome: sections.nonOperatingIncome.total,
        nonOperatingExpense: sections.nonOperatingExpense.total,
        nonOperatingNet: sections.nonOperatingIncome.total - sections.nonOperatingExpense.total,
        preTaxIncome: sections.preTaxIncome.total,
        tax: sections.tax.total,
        netIncome: sections.netIncome.total,
        netMargin: rev > 0 ? sections.netIncome.total / rev : 0,
      },
    };
  }

  // ===== 資產負債表 (Balance Sheet) — 日期範圍版 =====

  async getBalanceSheetByDate(endDate, opts = {}) {
    const cid = opts.companyId;
    const cacheKey = this.getCacheKey('bs', endDate, cid || 'default');
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const [glEntries, accountsMap] = await Promise.all([
      this.bc.getGeneralLedgerEntries(null, endDate, { fetchAll: true, companyId: cid }),
      this.bc.getAccountsMap({ companyId: cid }),
    ]);

    const period = { endDate };
    const result = this.buildBalanceSheet(glEntries, accountsMap, period);
    this.setCache(cacheKey, result);
    return result;
  }

  // 向下相容：年/月版
  async getBalanceSheet(year, month) {
    const { end } = BCClient.getMonthRange(year, month);
    return this.getBalanceSheetByDate(end);
  }

  buildBalanceSheet(glEntries, accountsMap, period) {
    const accountTotals = {};
    for (const entry of glEntries) {
      const accNum = entry.accountNumber;
      if (!accountTotals[accNum]) accountTotals[accNum] = { debit: 0, credit: 0 };
      accountTotals[accNum].debit += entry.debitAmount || 0;
      accountTotals[accNum].credit += entry.creditAmount || 0;
    }

    const sections = {
      currentAssets: { label: '流動資產', items: [], total: 0 },
      nonCurrentAssets: { label: '非流動資產', items: [], total: 0 },
      totalAssets: { label: '資產合計', total: 0 },
      currentLiabilities: { label: '流動負債', items: [], total: 0 },
      nonCurrentLiabilities: { label: '非流動負債', items: [], total: 0 },
      totalLiabilities: { label: '負債合計', total: 0 },
      equity: { label: '業主權益', items: [], total: 0 },
      totalLiabilitiesAndEquity: { label: '負債及業主權益合計', total: 0 },
    };

    for (const [accNum, totals] of Object.entries(accountTotals)) {
      const info = accountsMap[accNum];
      if (!info || info.accountType !== 'Posting') continue;

      const cat = info.category;
      const balance = totals.debit - totals.credit;
      const item = {
        accountNumber: accNum,
        displayName: info.displayName,
        subCategory: info.subCategory || '',
        balance,
      };

      if (cat === 'Assets') {
        if (accNum < '150000') {
          sections.currentAssets.items.push(item);
          sections.currentAssets.total += balance;
        } else {
          sections.nonCurrentAssets.items.push(item);
          sections.nonCurrentAssets.total += balance;
        }
      } else if (cat === 'Liabilities') {
        item.balance = totals.credit - totals.debit;
        if (accNum < '250000') {
          sections.currentLiabilities.items.push(item);
          sections.currentLiabilities.total += item.balance;
        } else {
          sections.nonCurrentLiabilities.items.push(item);
          sections.nonCurrentLiabilities.total += item.balance;
        }
      } else if (cat === 'Equity') {
        item.balance = totals.credit - totals.debit;
        sections.equity.items.push(item);
        sections.equity.total += item.balance;
      }
    }

    sections.totalAssets.total = sections.currentAssets.total + sections.nonCurrentAssets.total;
    sections.totalLiabilities.total = sections.currentLiabilities.total + sections.nonCurrentLiabilities.total;
    sections.totalLiabilitiesAndEquity.total = sections.totalLiabilities.total + sections.equity.total;

    for (const section of Object.values(sections)) {
      if (section.items) {
        section.items.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
      }
    }

    return {
      period,
      sections,
      summary: {
        totalAssets: sections.totalAssets.total,
        currentAssets: sections.currentAssets.total,
        nonCurrentAssets: sections.nonCurrentAssets.total,
        totalLiabilities: sections.totalLiabilities.total,
        currentLiabilities: sections.currentLiabilities.total,
        nonCurrentLiabilities: sections.nonCurrentLiabilities.total,
        equity: sections.equity.total,
        totalLiabilitiesAndEquity: sections.totalLiabilitiesAndEquity.total,
      },
    };
  }

  // ===== EBITDA =====

  async getEbitda(year, month) {
    const { start, end } = BCClient.getMonthRange(year, month);
    return this.getEbitdaByRange(start, end);
  }

  async getEbitdaByRange(startDate, endDate, opts = {}) {
    const cid = opts.companyId;
    const cacheKey = this.getCacheKey('ebitda', startDate, endDate, cid || 'default');
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const glEntries = await this.bc.getGeneralLedgerEntries(startDate, endDate, { fetchAll: true, companyId: cid });
    const result = this.calculateEbitda(glEntries, opts.accountsMapping);
    this.setCache(cacheKey, result);
    return result;
  }

  calculateEbitda(glEntries, mappingFile) {
    const mapping = this.getAccountsMapping(mappingFile);
    let revenue = 0, cogs = 0, operatingExpenses = 0;
    let depreciation = 0, amortization = 0, interestExpense = 0, taxExpense = 0;

    for (const entry of glEntries) {
      const accNum = entry.accountNumber;
      const amount = (entry.debitAmount || 0) - (entry.creditAmount || 0);

      if (this.inRange(accNum, mapping.revenue || [])) revenue += Math.abs(amount);
      else if (this.inRange(accNum, mapping.cogs || [])) cogs += Math.abs(amount);
      else if (this.inRange(accNum, mapping.depreciation || [])) depreciation += Math.abs(amount);
      else if (this.inRange(accNum, mapping.amortization || [])) amortization += Math.abs(amount);
      else if (this.inRange(accNum, mapping.interest_expense || [])) interestExpense += Math.abs(amount);
      else if (this.inRange(accNum, mapping.tax_expense || [])) taxExpense += Math.abs(amount);
      else if (this.inRange(accNum, mapping.operating_expenses || [])) operatingExpenses += Math.abs(amount);
    }

    const grossProfit = revenue - cogs;
    const operatingIncome = grossProfit - operatingExpenses;
    const ebitda = operatingIncome + depreciation + amortization;
    const ebt = operatingIncome - interestExpense;
    const netIncome = ebt - taxExpense;

    return {
      revenue, cogs, grossProfit, operatingExpenses, operatingIncome,
      depreciation, amortization, ebitda, interestExpense, taxExpense, ebt, netIncome,
      ebitdaMargin: revenue > 0 ? ebitda / revenue : 0,
      grossMargin: revenue > 0 ? grossProfit / revenue : 0,
      operatingMargin: revenue > 0 ? operatingIncome / revenue : 0,
      netMargin: revenue > 0 ? netIncome / revenue : 0,
    };
  }

  // ===== Account Range Helper =====

  inRange(accNum, ranges) {
    return ranges.some(range => {
      if (range.includes('-')) {
        const [lo, hi] = range.split('-');
        return accNum >= lo && accNum <= hi;
      }
      return accNum === range;
    });
  }

  // ===== Comparison Reports (日期範圍版) =====

  async getISComparison(startDate, endDate, compareType, opts = {}) {
    const current = await this.getIncomeStatementByRange(startDate, endDate, opts);
    const prev = this.getComparisonRange(startDate, endDate, compareType);

    let previous = null;
    try {
      previous = await this.getIncomeStatementByRange(prev.startDate, prev.endDate, opts);
    } catch (e) {
      console.warn('[ReportEngine] No comparison data:', e.message);
    }

    return {
      current,
      previous,
      changes: previous ? this.computeSummaryChanges(current.summary, previous.summary) : null,
      period: { startDate, endDate },
      comparePeriod: previous ? prev : null,
      compareType,
    };
  }

  async getBSComparison(endDate, compareType, opts = {}) {
    const current = await this.getBalanceSheetByDate(endDate, opts);
    // For BS comparison, shift the endDate
    const fakeStart = endDate; // only endDate matters for BS
    const prev = this.getComparisonRange(fakeStart, endDate, compareType);

    let previous = null;
    try {
      previous = await this.getBalanceSheetByDate(prev.endDate, opts);
    } catch (e) {
      console.warn('[ReportEngine] No comparison data:', e.message);
    }

    return {
      current,
      previous,
      changes: previous ? this.computeSummaryChanges(current.summary, previous.summary) : null,
      period: { endDate },
      comparePeriod: previous ? { endDate: prev.endDate } : null,
      compareType,
    };
  }

  // 向下相容
  async getIncomeStatementComparison(year, month, compareType) {
    const { start, end } = BCClient.getMonthRange(year, month);
    return this.getISComparison(start, end, compareType);
  }

  async getBalanceSheetComparison(year, month, compareType) {
    const { end } = BCClient.getMonthRange(year, month);
    return this.getBSComparison(end, compareType);
  }

  async getEbitdaComparison(year, month, compareType) {
    const current = await this.getEbitda(year, month);
    const { year: prevYear, month: prevMonth } = this.getPreviousPeriod(year, month, compareType);
    let previous = null;
    try { previous = await this.getEbitda(prevYear, prevMonth); } catch (e) {}
    return this.buildComparisonReport(current, previous, { year, month }, { year: prevYear, month: prevMonth }, compareType);
  }

  computeSummaryChanges(current, previous) {
    const changes = {};
    for (const key of Object.keys(current)) {
      if (typeof current[key] === 'number' && typeof previous[key] === 'number') {
        const diff = current[key] - previous[key];
        const pct = previous[key] !== 0 ? diff / Math.abs(previous[key]) : null;
        changes[key] = { diff, pct };
      }
    }
    return changes;
  }

  buildComparisonReport(current, previous, period, comparePeriod, compareType) {
    const changes = {};
    if (previous) {
      for (const key of Object.keys(current)) {
        if (typeof current[key] === 'number' && typeof previous[key] === 'number') {
          const diff = current[key] - previous[key];
          const pct = previous[key] !== 0 ? diff / Math.abs(previous[key]) : null;
          changes[key] = { diff, pct };
        }
      }
    }
    return { current, previous, changes, period, comparePeriod: previous ? comparePeriod : null, compareType };
  }

  // ===== Period Helpers (向下相容) =====

  getPreviousPeriod(year, month, compareType) {
    if (compareType === 'yoy') return { year: year - 1, month };
    if (compareType === 'mom') {
      let m = month - 1, y = year;
      if (m < 1) { m = 12; y--; }
      return { year: y, month: m };
    }
    if (compareType === 'qoq') {
      let m = month - 3, y = year;
      if (m < 1) { m += 12; y--; }
      return { year: y, month: m };
    }
    return { year, month };
  }

  // ===== 費用比較報表 (Expense Comparison) =====

  /**
   * 取得多期間費用明細，支援月vs月、年vs年比較
   * @param {Array<{startDate, endDate, label}>} periods - 要比較的期間列表
   * @param {string} expenseRange - 科目範圍，如 "510100-631038"
   * @param {Object} opts - companyId, accountsMapping
   * @returns {Object} { periods, accounts, totals }
   */
  async getExpenseComparison(periods, expenseRange = '510100-631038', opts = {}) {
    const cid = opts.companyId;
    const department = opts.department; // 部門篩選（空字串 = 全部）
    const [rangeStart, rangeEnd] = expenseRange.split('-');

    // If department filter requested, expand dimensionSetLines
    const needDimension = !!department;
    const glOpts = { fetchAll: true, companyId: cid };
    if (needDimension) glOpts.expand = 'dimensionSetLines';

    // Fetch GL entries + accounts map for all periods in parallel
    const accountsMapPromise = this.bc.getAccountsMap({ companyId: cid });
    const glPromises = periods.map(p =>
      this.bc.getGeneralLedgerEntries(p.startDate, p.endDate, glOpts)
    );

    const [accountsMap, ...glResults] = await Promise.all([accountsMapPromise, ...glPromises]);

    // Build per-period expense breakdown
    const periodData = glResults.map((glEntries, idx) => {
      const accountTotals = {};
      for (const entry of glEntries) {
        const accNum = entry.accountNumber;
        if (accNum < rangeStart || accNum > rangeEnd) continue;
        const info = accountsMap[accNum];
        if (!info || info.accountType !== 'Posting') continue;
        // Department filter
        if (needDimension) {
          const dims = entry.dimensionSetLines || [];
          const dept = dims.find(d => d.code === '部門');
          if (!dept || dept.valueCode !== department) continue;
        }
        if (!accountTotals[accNum]) accountTotals[accNum] = 0;
        accountTotals[accNum] += Math.abs((entry.debitAmount || 0) - (entry.creditAmount || 0));
      }
      return accountTotals;
    });

    // Collect all unique accounts across periods
    const allAccounts = new Set();
    for (const pt of periodData) {
      for (const acc of Object.keys(pt)) allAccounts.add(acc);
    }
    const sortedAccounts = [...allAccounts].sort();

    // Build account rows with per-period amounts
    const accounts = sortedAccounts.map(accNum => {
      const info = accountsMap[accNum] || {};
      const amounts = periodData.map(pt => pt[accNum] || 0);
      return {
        accountNumber: accNum,
        displayName: info.displayName || accNum,
        subCategory: info.subCategory || '',
        amounts,
      };
    });

    // Group by subCategory
    const categoryMap = {};
    for (const acc of accounts) {
      const cat = acc.subCategory || acc.displayName;
      if (!categoryMap[cat]) categoryMap[cat] = { name: cat, amounts: periods.map(() => 0), accounts: [] };
      categoryMap[cat].accounts.push(acc);
      acc.amounts.forEach((a, i) => { categoryMap[cat].amounts[i] += a; });
    }
    const categories = Object.values(categoryMap).sort((a, b) => {
      const aMin = a.accounts[0]?.accountNumber || '';
      const bMin = b.accounts[0]?.accountNumber || '';
      return aMin.localeCompare(bMin);
    });

    // Totals per period
    const totals = periods.map((_, i) => accounts.reduce((sum, acc) => sum + acc.amounts[i], 0));

    // Changes between periods (each vs first period)
    const changes = totals.map((t, i) => {
      if (i === 0) return null;
      const diff = t - totals[0];
      const pct = totals[0] !== 0 ? diff / Math.abs(totals[0]) : null;
      return { diff, pct };
    });

    return {
      periods: periods.map((p, i) => ({ ...p, total: totals[i] })),
      accounts,
      categories,
      totals,
      changes,
      expenseRange,
      department: department || null,
    };
  }

  /**
   * 銷售比較 — 指定銷售科目 + 銷售成本 → 毛利率
   */
  async getSalesComparison(periods, accountNumbers = ['411111', '411112', '411113'], opts = {}) {
    const cid = opts.companyId;
    const department = opts.department;
    const salesAcctSet = new Set(accountNumbers);

    const needDimension = !!department;
    const glOpts = { fetchAll: true, companyId: cid };
    if (needDimension) glOpts.expand = 'dimensionSetLines';

    const accountsMapPromise = this.bc.getAccountsMap({ companyId: cid });
    const glPromises = periods.map(p =>
      this.bc.getGeneralLedgerEntries(p.startDate, p.endDate, glOpts)
    );

    const [accountsMap, ...glResults] = await Promise.all([accountsMapPromise, ...glPromises]);

    // 銷售成本科目: 611010~611038 (銷售費用) + 510100 (勞務成本-理貨) + 510102 (直接人工)
    const cogsAcctSet = new Set(['510100', '510102']);
    for (const [accNum, info] of Object.entries(accountsMap)) {
      if (accNum >= '611010' && accNum <= '611038' && info.accountType === 'Posting') {
        cogsAcctSet.add(accNum);
      }
    }

    // Build per-period breakdown: sales accounts + COGS accounts
    const salesPeriodData = [];
    const cogsPeriodData = [];

    for (const glEntries of glResults) {
      const salesTotals = {};
      const cogsTotals = {};
      for (const entry of glEntries) {
        const accNum = entry.accountNumber;
        const isSales = salesAcctSet.has(accNum);
        const isCogs = cogsAcctSet.has(accNum);
        if (!isSales && !isCogs) continue;
        const info = accountsMap[accNum];
        if (!info || info.accountType !== 'Posting') continue;
        if (needDimension) {
          const dims = entry.dimensionSetLines || [];
          const dept = dims.find(d => d.code === '部門');
          if (!dept || dept.valueCode !== department) continue;
        }
        if (isSales) {
          if (!salesTotals[accNum]) salesTotals[accNum] = 0;
          salesTotals[accNum] += (entry.creditAmount || 0) - (entry.debitAmount || 0);
        }
        if (isCogs) {
          if (!cogsTotals[accNum]) cogsTotals[accNum] = 0;
          cogsTotals[accNum] += Math.abs((entry.debitAmount || 0) - (entry.creditAmount || 0));
        }
      }
      salesPeriodData.push(salesTotals);
      cogsPeriodData.push(cogsTotals);
    }

    // Sales account rows
    const salesAccounts = accountNumbers.map(accNum => {
      const info = accountsMap[accNum] || {};
      const amounts = salesPeriodData.map(pt => pt[accNum] || 0);
      return { accountNumber: accNum, displayName: info.displayName || accNum, amounts };
    });

    // COGS account rows (only accounts with non-zero amounts)
    const allCogsAccts = [...cogsAcctSet].sort();
    const cogsAccounts = allCogsAccts
      .map(accNum => {
        const info = accountsMap[accNum] || {};
        const amounts = cogsPeriodData.map(pt => pt[accNum] || 0);
        return { accountNumber: accNum, displayName: info.displayName || accNum, amounts };
      })
      .filter(acc => acc.amounts.some(a => a !== 0));

    // Totals
    const salesTotals = periods.map((_, i) => salesAccounts.reduce((sum, acc) => sum + acc.amounts[i], 0));
    const cogsTotals = periods.map((_, i) => cogsAccounts.reduce((sum, acc) => sum + acc.amounts[i], 0));
    const grossProfit = periods.map((_, i) => salesTotals[i] - cogsTotals[i]);
    const grossMargin = periods.map((_, i) => salesTotals[i] !== 0 ? grossProfit[i] / salesTotals[i] : null);

    // Changes
    const salesChanges = salesTotals.map((t, i) => {
      if (i === 0) return null;
      const diff = t - salesTotals[0];
      return { diff, pct: salesTotals[0] !== 0 ? diff / Math.abs(salesTotals[0]) : null };
    });
    const cogsChanges = cogsTotals.map((t, i) => {
      if (i === 0) return null;
      const diff = t - cogsTotals[0];
      return { diff, pct: cogsTotals[0] !== 0 ? diff / Math.abs(cogsTotals[0]) : null };
    });
    const gpChanges = grossProfit.map((t, i) => {
      if (i === 0) return null;
      const diff = t - grossProfit[0];
      return { diff, pct: grossProfit[0] !== 0 ? diff / Math.abs(grossProfit[0]) : null };
    });

    return {
      periods: periods.map((p, i) => ({ ...p, salesTotal: salesTotals[i], cogsTotal: cogsTotals[i], grossProfit: grossProfit[i], grossMargin: grossMargin[i] })),
      salesAccounts,
      cogsAccounts,
      salesTotals,
      cogsTotals,
      grossProfit,
      grossMargin,
      salesChanges,
      cogsChanges,
      gpChanges,
      department: department || null,
    };
  }

  /**
   * 取得可用部門列表（從最近 GL entries 的 dimensionSetLines）
   */
  async getDepartments(opts = {}) {
    const cid = opts.companyId;
    const cacheKey = this.getCacheKey('departments', cid);
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    // Fetch recent 3 months of entries with dimensions (departments rarely change)
    const now = new Date();
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const start = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`;
    const end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`;
    const entries = await this.bc.getGeneralLedgerEntries(start, end, {
      fetchAll: true, companyId: cid, expand: 'dimensionSetLines',
    });

    const deptSet = new Set();
    for (const entry of entries) {
      const dims = entry.dimensionSetLines || [];
      const dept = dims.find(d => d.code === '部門');
      if (dept) deptSet.add(dept.valueCode);
    }
    const result = [...deptSet].sort();
    this.setCache(cacheKey, result);
    return result;
  }

  // ===== YTD =====

  async getEbitdaYTD(year, upToMonth) {
    let ytd = {
      revenue: 0, cogs: 0, grossProfit: 0, operatingExpenses: 0,
      depreciation: 0, amortization: 0, operatingIncome: 0, ebitda: 0,
      interestExpense: 0, taxExpense: 0, netIncome: 0,
    };
    for (let m = 1; m <= upToMonth; m++) {
      const monthly = await this.getEbitda(year, m);
      for (const key of Object.keys(ytd)) ytd[key] += monthly[key] || 0;
    }
    ytd.ebitdaMargin = ytd.revenue > 0 ? ytd.ebitda / ytd.revenue : 0;
    ytd.grossMargin = ytd.revenue > 0 ? ytd.grossProfit / ytd.revenue : 0;
    ytd.netMargin = ytd.revenue > 0 ? ytd.netIncome / ytd.revenue : 0;
    return ytd;
  }
}

module.exports = ReportEngine;
