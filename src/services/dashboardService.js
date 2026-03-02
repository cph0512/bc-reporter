// src/services/dashboardService.js
// Dashboard KPI + Chart data service

const BCClient = require('./bcClient');

class DashboardService {
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

  // ===== Main Entry =====

  async getDashboardData(opts = {}) {
    const cid = opts.companyId || 'default';
    const now = new Date();
    const targetMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const targetYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    const cacheKey = `dashboard:${cid}:${targetYear}:${targetMonth}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const { start: periodStart, end: periodEnd } = BCClient.getMonthRange(targetYear, targetMonth);

    // Fetch current period data + customers/vendors in parallel
    const [is, bs, customers, vendors] = await Promise.all([
      this.engine.getIncomeStatementByRange(periodStart, periodEnd, opts),
      this.engine.getBalanceSheetByDate(periodEnd, opts),
      this.safeGetCustomers(opts),
      this.safeGetVendors(opts),
    ]);

    // Fetch monthly trends (12 months) — heavier, runs after main data
    const trends = await this.getMonthlyTrends(targetYear, targetMonth, opts, 12);

    const daysInPeriod = this.daysBetween(periodStart, periodEnd);
    const kpis = this.computeKPIs(is, bs, customers, vendors, daysInPeriod, opts);

    const result = {
      period: { startDate: periodStart, endDate: periodEnd, year: targetYear, month: targetMonth },
      kpis,
      charts: {
        roaByMonth: trends.roaByMonth,
        netProfitMarginByMonth: trends.netProfitMarginByMonth,
        assetTurnoverByMonth: trends.assetTurnoverByMonth,
        top5Customers: this.getTop5(customers),
        top5Vendors: this.getTop5(vendors),
      },
    };

    this.setCache(cacheKey, result);
    return result;
  }

  // ===== KPI Calculations =====

  computeKPIs(is, bs, customers, vendors, daysInPeriod, opts) {
    const revenue = is.summary.revenue;
    const cogs = is.summary.cogs;
    const netProfit = is.summary.netIncome;
    const netProfitMargin = is.summary.netMargin;
    const totalAssets = bs.summary.totalAssets;

    // AR: from customers API total balance, or from GL mapping
    let ar = null;
    if (customers && customers.length > 0) {
      ar = customers.reduce((sum, c) => sum + (c.balance || 0), 0);
    }

    // AP: from vendors API total balance, or from GL mapping
    let ap = null;
    if (vendors && vendors.length > 0) {
      ap = Math.abs(vendors.reduce((sum, v) => sum + (v.balance || 0), 0));
    }

    // DSO
    let dso = null;
    if (ar !== null && revenue !== 0) {
      dso = (Math.abs(ar) / Math.abs(revenue)) * daysInPeriod;
    }

    // DIO — requires inventory mapping (not yet configured by default)
    const dio = null;

    // DPO
    let dpo = null;
    if (ap !== null && cogs !== 0) {
      dpo = (Math.abs(ap) / Math.abs(cogs)) * daysInPeriod;
    }

    return {
      revenue,
      netProfit,
      netProfitMargin,
      totalAssets,
      dso,
      dio,
      dpo,
    };
  }

  // ===== Monthly Trends =====

  async getMonthlyTrends(targetYear, targetMonth, opts, monthsBack = 12) {
    const months = [];
    let y = targetYear, m = targetMonth;
    for (let i = 0; i < monthsBack; i++) {
      months.unshift({ year: y, month: m });
      m--;
      if (m < 1) { m = 12; y--; }
    }

    const results = await Promise.all(months.map(async ({ year, month }) => {
      const { start, end } = BCClient.getMonthRange(year, month);
      const [is, bs] = await Promise.all([
        this.engine.getIncomeStatementByRange(start, end, opts),
        this.engine.getBalanceSheetByDate(end, opts),
      ]);
      return { year, month, is, bs };
    }));

    const roaByMonth = [];
    const netProfitMarginByMonth = [];
    const assetTurnoverByMonth = [];

    for (const { year, month, is, bs } of results) {
      const label = `${year}-${String(month).padStart(2, '0')}`;
      const revenue = is.summary.revenue;
      const netIncome = is.summary.netIncome;
      const totalAssets = bs.summary.totalAssets;

      roaByMonth.push({
        label,
        value: totalAssets !== 0 ? netIncome / totalAssets : null,
      });
      netProfitMarginByMonth.push({
        label,
        value: revenue !== 0 ? netIncome / revenue : null,
      });
      assetTurnoverByMonth.push({
        label,
        value: totalAssets !== 0 ? revenue / totalAssets : null,
      });
    }

    return { roaByMonth, netProfitMarginByMonth, assetTurnoverByMonth };
  }

  // ===== Helpers =====

  async safeGetCustomers(opts) {
    try {
      return await this.bc.getCustomers({ companyId: opts.companyId }) || [];
    } catch { return []; }
  }

  async safeGetVendors(opts) {
    try {
      return await this.bc.getVendors({ companyId: opts.companyId }) || [];
    } catch { return []; }
  }

  getTop5(entities) {
    if (!entities || !entities.length) return [];
    return [...entities]
      .sort((a, b) => Math.abs(b.balance || 0) - Math.abs(a.balance || 0))
      .slice(0, 5)
      .map(e => ({ name: e.displayName || e.number, value: e.balance || 0 }));
  }

  daysBetween(start, end) {
    const s = new Date(start);
    const e = new Date(end);
    return Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
  }
}

module.exports = DashboardService;
