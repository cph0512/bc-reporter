// src/services/salesDashboardService.js
// Sales Dashboard — 使用 GL Entries + Customers + Accounts Map
// 不依賴 salesInvoices API（多數租戶未開啟）

const BCClient = require('./bcClient');
const path = require('path');
const fs = require('fs');

class SalesDashboardService {
  constructor(reportEngine) {
    this.engine = reportEngine;
    this.bc = reportEngine.bc;
    this.cache = new Map();
    this.cacheTTL = 30 * 60 * 1000; // 30 minutes
  }

  // ===== Cache =====

  getCached(key) {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.ts < this.cacheTTL) return entry.data;
    this.cache.delete(key);
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, { data, ts: Date.now() });
  }

  // ===== Load account mapping =====

  loadMapping(mappingFile) {
    const filename = mappingFile || 'accounts-mapping.json';
    const configPath = path.join(__dirname, '../../config', filename);
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  inRange(accNum, ranges) {
    return ranges.some(range => {
      if (range.includes('-')) {
        const [lo, hi] = range.split('-');
        return accNum >= lo && accNum <= hi;
      }
      return accNum === range;
    });
  }

  // ===== Main Entry =====

  async getSalesDashboardData(opts = {}) {
    const cid = opts.companyId || 'default';

    // Determine period
    let periodStart, periodEnd, targetYear, targetMonth;

    if (opts.startDate && opts.endDate) {
      periodStart = opts.startDate;
      periodEnd = opts.endDate;
      const d = new Date(opts.endDate);
      targetYear = d.getFullYear();
      targetMonth = d.getMonth() + 1;
    } else {
      const now = new Date();
      targetMonth = now.getMonth() === 0 ? 12 : now.getMonth();
      targetYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      periodStart = `${targetYear}-01-01`;
      ({ end: periodEnd } = BCClient.getMonthRange(targetYear, targetMonth));
    }

    const cacheKey = `sales-dash:${cid}:${periodStart}:${periodEnd}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    // Load accounts mapping for revenue/cogs ranges
    const mapping = this.loadMapping(opts.accountsMapping);
    const revenueRanges = mapping.revenue || [];
    const cogsRanges = mapping.cogs || [];

    // Build 12-month windows
    const months = this.getLast12Months(targetYear, targetMonth);
    const twelveMonthStart = months[0].start;

    // Fetch GL entries (12-month window) + accounts map + customers in parallel
    const [glEntries, accountsMap, customers] = await Promise.all([
      this.safeGetGLEntries(twelveMonthStart, periodEnd, opts),
      this.safeGetAccountsMap(opts),
      this.safeGetCustomers(opts),
    ]);

    if (!glEntries) {
      return {
        period: { startDate: periodStart, endDate: periodEnd, year: targetYear, month: targetMonth },
        error: 'GL entries not available',
        kpis: { totalRevenue: 0, totalCogs: 0, grossProfit: 0, grossMargin: 0, topCustomerName: null, topCustomerBalance: 0 },
        charts: { revenueByMonth: [], revenueByCategory: [], top5Customers: [], grossProfitByMonth: [] },
      };
    }

    // Classify GL entries into revenue and COGS
    const revenueEntries = [];
    const cogsEntries = [];

    for (const entry of glEntries) {
      const accNum = entry.accountNumber || '';
      if (this.inRange(accNum, revenueRanges)) {
        revenueEntries.push(entry);
      } else if (this.inRange(accNum, cogsRanges)) {
        cogsEntries.push(entry);
      }
    }

    // Filter to requested period for KPIs
    const periodRevEntries = revenueEntries.filter(
      e => e.postingDate >= periodStart && e.postingDate <= periodEnd
    );
    const periodCogsEntries = cogsEntries.filter(
      e => e.postingDate >= periodStart && e.postingDate <= periodEnd
    );

    // Compute KPIs
    const totalRevenue = periodRevEntries.reduce((s, e) => s + Math.abs(e.creditAmount - e.debitAmount), 0);
    const totalCogs = periodCogsEntries.reduce((s, e) => s + Math.abs(e.debitAmount - e.creditAmount), 0);
    const grossProfit = totalRevenue - totalCogs;
    const grossMargin = totalRevenue > 0 ? grossProfit / totalRevenue : 0;

    // Top customer from customers API (by balance = AR)
    const sortedCustomers = (customers || [])
      .filter(c => c.balance != null)
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
    const topCustomer = sortedCustomers.length > 0 ? sortedCustomers[0] : null;

    const kpis = {
      totalRevenue,
      totalCogs,
      grossProfit,
      grossMargin,
      topCustomerName: topCustomer?.displayName || null,
      topCustomerBalance: topCustomer ? Math.abs(topCustomer.balance) : 0,
    };

    // Charts

    // 1. Revenue by month (12 months)
    const revenueByMonth = this.computeMonthlyTotals(revenueEntries, months, true);

    // 2. Revenue by sub-category (from accounts map)
    const revenueByCategory = this.computeRevenueByCategory(periodRevEntries, accountsMap);

    // 3. Top 5 customers (by balance)
    const top5Customers = sortedCustomers.slice(0, 5).map(c => ({
      name: c.displayName || c.number,
      value: Math.abs(c.balance || 0),
    }));

    // 4. Gross profit by month (revenue - cogs per month)
    const grossProfitByMonth = this.computeGrossProfitByMonth(revenueEntries, cogsEntries, months);

    const result = {
      period: { startDate: periodStart, endDate: periodEnd, year: targetYear, month: targetMonth },
      kpis,
      charts: { revenueByMonth, revenueByCategory, top5Customers, grossProfitByMonth },
    };

    this.setCache(cacheKey, result);
    return result;
  }

  // ===== Helpers =====

  getLast12Months(targetYear, targetMonth) {
    const months = [];
    let y = targetYear, m = targetMonth;
    for (let i = 0; i < 12; i++) {
      const { start, end } = BCClient.getMonthRange(y, m);
      months.unshift({ year: y, month: m, start, end });
      m--;
      if (m < 1) { m = 12; y--; }
    }
    return months;
  }

  computeMonthlyTotals(entries, months, isRevenue = true) {
    return months.map(({ year, month, start, end }) => {
      const label = `${year}-${String(month).padStart(2, '0')}`;
      const filtered = entries.filter(e => e.postingDate >= start && e.postingDate <= end);
      const total = filtered.reduce((s, e) => {
        return s + Math.abs(isRevenue ? (e.creditAmount - e.debitAmount) : (e.debitAmount - e.creditAmount));
      }, 0);
      return { label, value: total };
    });
  }

  computeRevenueByCategory(entries, accountsMap) {
    const categoryMap = {};
    for (const entry of entries) {
      const accNum = entry.accountNumber || '';
      const accInfo = accountsMap?.[accNum];
      const catName = accInfo?.subCategory || accInfo?.displayName || accNum;
      // Skip "合計" summary accounts
      if (catName.includes('合計')) continue;
      const amount = Math.abs(entry.creditAmount - entry.debitAmount);
      if (amount < 0.5) continue;
      categoryMap[catName] = (categoryMap[catName] || 0) + amount;
    }
    return Object.entries(categoryMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }

  computeGrossProfitByMonth(revenueEntries, cogsEntries, months) {
    return months.map(({ year, month, start, end }) => {
      const label = `${year}-${String(month).padStart(2, '0')}`;
      const rev = revenueEntries
        .filter(e => e.postingDate >= start && e.postingDate <= end)
        .reduce((s, e) => s + Math.abs(e.creditAmount - e.debitAmount), 0);
      const cogs = cogsEntries
        .filter(e => e.postingDate >= start && e.postingDate <= end)
        .reduce((s, e) => s + Math.abs(e.debitAmount - e.creditAmount), 0);
      return { label, revenue: rev, cogs, grossProfit: rev - cogs };
    });
  }

  // ===== Safe API calls =====

  async safeGetGLEntries(start, end, opts) {
    try {
      return await this.bc.getGeneralLedgerEntries(start, end, {
        companyId: opts.companyId,
        fetchAll: true,
      });
    } catch (e) {
      console.error('[SalesDashboard] GL entries error:', e.message);
      return null;
    }
  }

  async safeGetAccountsMap(opts) {
    try {
      return await this.bc.getAccountsMap({ companyId: opts.companyId });
    } catch (e) {
      console.error('[SalesDashboard] AccountsMap error:', e.message);
      return {};
    }
  }

  async safeGetCustomers(opts) {
    try {
      return await this.bc.getCustomers({ companyId: opts.companyId }) || [];
    } catch (e) {
      console.error('[SalesDashboard] Customers error:', e.message);
      return [];
    }
  }
}

module.exports = SalesDashboardService;
