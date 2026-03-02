// src/services/purchasingDashboardService.js
// Purchasing Dashboard KPI + Chart data service
// Supports date filters via opts.startDate / opts.endDate

const BCClient = require('./bcClient');

class PurchasingDashboardService {
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

  async getPurchasingDashboardData(opts = {}) {
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

    const cacheKey = `purch-dash:${cid}:${periodStart}:${periodEnd}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    // Build 12-month range
    const months = this.getLast12Months(targetYear, targetMonth);
    const twelveMonthStart = months[0].start;

    // Previous year same period for PY comparison
    const prevYearStart = periodStart.replace(/^\d{4}/, String(targetYear - 1));
    const prevYearEnd = periodEnd.replace(/^\d{4}/, String(targetYear - 1));

    // Fetch all data in parallel
    const [invoices, prevYearInvoices, openOrders] = await Promise.all([
      this.safeGetPurchaseInvoices(twelveMonthStart, periodEnd, opts),
      this.safeGetPurchaseInvoices(prevYearStart, prevYearEnd, opts),
      this.safeGetPurchaseOrders(opts),
    ]);

    if (!invoices) {
      return {
        period: { startDate: periodStart, endDate: periodEnd, year: targetYear, month: targetMonth },
        error: 'purchaseInvoices API not available',
        kpis: { totalPurchases: null, purchasesPreviousYear: null, outstandingOrdersCount: null, outstandingAmount: null },
        charts: { purchasesByMonth: [], top5Vendors: [], byPurchaser: [] },
      };
    }

    // Filter to requested period for KPIs
    const periodInvoices = invoices.filter(
      i => i.invoiceDate >= periodStart && i.invoiceDate <= periodEnd
    );

    // KPIs
    const totalPurchases = periodInvoices.reduce((s, i) => s + (i.totalAmountExcludingTax || 0), 0);
    const purchasesPY = prevYearInvoices
      ? prevYearInvoices.reduce((s, i) => s + (i.totalAmountExcludingTax || 0), 0)
      : null;
    const outstandingCount = openOrders ? openOrders.length : null;
    const outstandingAmount = openOrders
      ? openOrders.reduce((s, o) => s + (o.totalAmountExcludingTax || 0), 0)
      : null;

    const kpis = {
      totalPurchases,
      purchasesPreviousYear: purchasesPY,
      outstandingOrdersCount: outstandingCount,
      outstandingAmount,
    };

    // Charts
    const purchasesByMonth = this.computeMonthlyTotals(invoices, months);
    const vendorPurchases = this.groupBy(periodInvoices, 'vendorName', 'totalAmountExcludingTax');
    const top5Vendors = vendorPurchases.slice(0, 5);
    const byPurchaser = this.groupBy(periodInvoices, 'purchaser', 'totalAmountExcludingTax')
      .filter(p => p.name && p.name !== 'Unknown');

    const result = {
      period: { startDate: periodStart, endDate: periodEnd, year: targetYear, month: targetMonth },
      kpis,
      charts: { purchasesByMonth, top5Vendors, byPurchaser },
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

  computeMonthlyTotals(invoices, months) {
    return months.map(({ year, month, start, end }) => {
      const label = `${year}-${String(month).padStart(2, '0')}`;
      const total = invoices
        .filter(i => i.invoiceDate >= start && i.invoiceDate <= end)
        .reduce((s, i) => s + (i.totalAmountExcludingTax || 0), 0);
      return { label, value: total };
    });
  }

  groupBy(items, nameField, valueField) {
    const map = {};
    for (const item of items) {
      const key = item[nameField] || 'Unknown';
      map[key] = (map[key] || 0) + (item[valueField] || 0);
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }

  async safeGetPurchaseInvoices(start, end, opts) {
    try {
      return await this.bc.getPurchaseInvoices(start, end, { companyId: opts.companyId });
    } catch (e) {
      console.error('[PurchasingDashboard] getPurchaseInvoices error:', e.message);
      return null;
    }
  }

  async safeGetPurchaseOrders(opts) {
    try {
      return await this.bc.getPurchaseOrders({ companyId: opts.companyId });
    } catch (e) {
      console.error('[PurchasingDashboard] getPurchaseOrders error:', e.message);
      return null;
    }
  }
}

module.exports = PurchasingDashboardService;
