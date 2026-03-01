// src/services/reportEngine.js
// 報表引擎 — 負責產生 EBITDA、損益表、資產負債表 + 同期比較

const BCClient = require('./bcClient');
const accountsMapping = require('../../config/accounts-mapping.json');

class ReportEngine {
  constructor(bcClient) {
    this.bc = bcClient;
    this.cache = new Map(); // Simple in-memory cache
    this.cacheTTL = 10 * 60 * 1000; // 10 minutes
  }

  // ===== Cache Helper =====

  getCacheKey(type, year, month) {
    return `${type}:${year}:${month}`;
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

  // ===== Income Statement =====

  async getIncomeStatement(year, month) {
    const cacheKey = this.getCacheKey('is', year, month);
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const { filter } = BCClient.getMonthRange(year, month);
    const rawData = await this.bc.getIncomeStatement(filter);

    // BC returns rows with lineNumber, display, netChange, lineType, indentation
    // We need to structure this into our report format
    const result = this.parseIncomeStatement(rawData);
    this.setCache(cacheKey, result);
    return result;
  }

  parseIncomeStatement(rawRows) {
    // BC incomeStatement API returns rows matching the Account Schedule
    // Each row has: lineNumber, display (account name), netChange, lineType, indentation
    //
    // For a custom EBITDA calculation, we also look up accounts-mapping.json
    // to categorize by account number ranges.

    const report = {
      rows: rawRows.map(row => ({
        lineNumber: row.lineNumber,
        display: row.display,
        netChange: row.netChange || 0,
        lineType: row.lineType,       // "header", "detail", "total", "spacer"
        indentation: row.indentation || 0,
        dateFilter: row.dateFilter,
      })),
      // Also extract key totals by searching for known patterns
      summary: {},
    };

    // Try to identify key line items by display name patterns
    for (const row of report.rows) {
      const name = (row.display || '').toLowerCase();
      if (name.includes('revenue') || name.includes('營業收入') || name.includes('sales'))
        report.summary.revenue = row.netChange;
      if (name.includes('cost of') || name.includes('營業成本') || name.includes('cogs'))
        report.summary.cogs = Math.abs(row.netChange);
      if (name.includes('gross profit') || name.includes('毛利'))
        report.summary.grossProfit = row.netChange;
      if (name.includes('operating') && name.includes('expense') || name.includes('營業費用'))
        report.summary.operatingExpenses = Math.abs(row.netChange);
      if (name.includes('net income') || name.includes('淨利') || name.includes('net profit'))
        report.summary.netIncome = row.netChange;
    }

    return report;
  }

  // ===== Balance Sheet =====

  async getBalanceSheet(year, month) {
    const cacheKey = this.getCacheKey('bs', year, month);
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const dateFilter = BCClient.getEndOfMonth(year, month);
    const rawData = await this.bc.getBalanceSheet(dateFilter);

    const result = this.parseBalanceSheet(rawData);
    this.setCache(cacheKey, result);
    return result;
  }

  parseBalanceSheet(rawRows) {
    const report = {
      rows: rawRows.map(row => ({
        lineNumber: row.lineNumber,
        display: row.display,
        balance: row.balance || 0,
        lineType: row.lineType,
        indentation: row.indentation || 0,
        dateFilter: row.dateFilter,
      })),
      summary: {},
    };

    for (const row of report.rows) {
      const name = (row.display || '').toLowerCase();
      if (name.includes('total assets') || name.includes('資產總計'))
        report.summary.totalAssets = row.balance;
      if (name.includes('total liabilities') || name.includes('負債總計'))
        report.summary.totalLiabilities = row.balance;
      if (name.includes('equity') || name.includes('股東權益'))
        report.summary.equity = row.balance;
    }

    return report;
  }

  // ===== EBITDA =====

  async getEbitda(year, month) {
    const cacheKey = this.getCacheKey('ebitda', year, month);
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const { start, end } = BCClient.getMonthRange(year, month);
    const glEntries = await this.bc.getGeneralLedgerEntries(start, end);

    const result = this.calculateEbitda(glEntries);
    this.setCache(cacheKey, result);
    return result;
  }

  calculateEbitda(glEntries) {
    const mapping = accountsMapping;

    const inRange = (accNum, ranges) => {
      return ranges.some(range => {
        if (range.includes('-')) {
          const [lo, hi] = range.split('-');
          return accNum >= lo && accNum <= hi;
        }
        return accNum === range;
      });
    };

    let revenue = 0;
    let cogs = 0;
    let operatingExpenses = 0;
    let depreciation = 0;
    let amortization = 0;
    let interestExpense = 0;
    let taxExpense = 0;

    for (const entry of glEntries) {
      const accNum = entry.accountNumber;
      // In BC, revenue is typically credit (negative debitAmount or positive creditAmount)
      const amount = (entry.debitAmount || 0) - (entry.creditAmount || 0);

      if (inRange(accNum, mapping.revenue)) revenue += Math.abs(amount);
      else if (inRange(accNum, mapping.cogs)) cogs += Math.abs(amount);
      else if (inRange(accNum, mapping.depreciation)) depreciation += Math.abs(amount);
      else if (inRange(accNum, mapping.amortization)) amortization += Math.abs(amount);
      else if (inRange(accNum, mapping.interest_expense)) interestExpense += Math.abs(amount);
      else if (inRange(accNum, mapping.tax_expense)) taxExpense += Math.abs(amount);
      else if (inRange(accNum, mapping.operating_expenses)) operatingExpenses += Math.abs(amount);
    }

    const grossProfit = revenue - cogs;
    const operatingIncome = grossProfit - operatingExpenses;
    const ebitda = operatingIncome + depreciation + amortization;
    const ebt = operatingIncome - interestExpense;
    const netIncome = ebt - taxExpense;

    return {
      revenue,
      cogs,
      grossProfit,
      operatingExpenses,
      operatingIncome,
      depreciation,
      amortization,
      ebitda,
      interestExpense,
      taxExpense,
      ebt,
      netIncome,
      ebitdaMargin: revenue > 0 ? ebitda / revenue : 0,
      grossMargin: revenue > 0 ? grossProfit / revenue : 0,
      operatingMargin: revenue > 0 ? operatingIncome / revenue : 0,
      netMargin: revenue > 0 ? netIncome / revenue : 0,
    };
  }

  // ===== Comparison Reports =====

  async getIncomeStatementComparison(year, month, compareType) {
    const current = await this.getIncomeStatement(year, month);
    const { year: prevYear, month: prevMonth } = this.getPreviousPeriod(year, month, compareType);
    
    let previous = null;
    try {
      previous = await this.getIncomeStatement(prevYear, prevMonth);
    } catch (e) {
      console.warn('[ReportEngine] No comparison data available:', e.message);
    }

    return {
      current,
      previous,
      period: { year, month },
      comparePeriod: previous ? { year: prevYear, month: prevMonth } : null,
      compareType,
    };
  }

  async getBalanceSheetComparison(year, month, compareType) {
    const current = await this.getBalanceSheet(year, month);
    const { year: prevYear, month: prevMonth } = this.getPreviousPeriod(year, month, compareType);
    
    let previous = null;
    try {
      previous = await this.getBalanceSheet(prevYear, prevMonth);
    } catch (e) {
      console.warn('[ReportEngine] No comparison data available:', e.message);
    }

    return {
      current,
      previous,
      period: { year, month },
      comparePeriod: previous ? { year: prevYear, month: prevMonth } : null,
      compareType,
    };
  }

  async getEbitdaComparison(year, month, compareType) {
    const current = await this.getEbitda(year, month);
    const { year: prevYear, month: prevMonth } = this.getPreviousPeriod(year, month, compareType);
    
    let previous = null;
    try {
      previous = await this.getEbitda(prevYear, prevMonth);
    } catch (e) {
      console.warn('[ReportEngine] No comparison data available:', e.message);
    }

    return this.buildComparisonReport(current, previous, { year, month }, { year: prevYear, month: prevMonth }, compareType);
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

    return {
      current,
      previous,
      changes,
      period,
      comparePeriod: previous ? comparePeriod : null,
      compareType,
    };
  }

  // ===== Period Helpers =====

  getPreviousPeriod(year, month, compareType) {
    if (compareType === 'yoy') {
      return { year: year - 1, month };
    }
    if (compareType === 'mom') {
      let m = month - 1;
      let y = year;
      if (m < 1) { m = 12; y--; }
      return { year: y, month: m };
    }
    // quarter over quarter
    if (compareType === 'qoq') {
      let m = month - 3;
      let y = year;
      if (m < 1) { m += 12; y--; }
      return { year: y, month: m };
    }
    return { year, month };
  }

  // ===== YTD (Year-to-Date) =====

  async getEbitdaYTD(year, upToMonth) {
    let ytd = {
      revenue: 0, cogs: 0, grossProfit: 0, operatingExpenses: 0,
      depreciation: 0, amortization: 0, operatingIncome: 0, ebitda: 0,
      interestExpense: 0, taxExpense: 0, netIncome: 0,
    };

    for (let m = 1; m <= upToMonth; m++) {
      const monthly = await this.getEbitda(year, m);
      for (const key of Object.keys(ytd)) {
        ytd[key] += monthly[key] || 0;
      }
    }

    // Recalculate margins
    ytd.ebitdaMargin = ytd.revenue > 0 ? ytd.ebitda / ytd.revenue : 0;
    ytd.grossMargin = ytd.revenue > 0 ? ytd.grossProfit / ytd.revenue : 0;
    ytd.netMargin = ytd.revenue > 0 ? ytd.netIncome / ytd.revenue : 0;

    return ytd;
  }
}

module.exports = ReportEngine;
