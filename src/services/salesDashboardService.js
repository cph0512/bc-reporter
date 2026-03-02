// src/services/salesDashboardService.js
// Sales Dashboard KPI + Chart data service
// Supports date filters via opts.startDate / opts.endDate

const BCClient = require('./bcClient');

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

  // ===== Main Entry =====

  async getSalesDashboardData(opts = {}) {
    const cid = opts.companyId || 'default';

    // Determine period: use provided dates or default to current month
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

    // Build 12-month range ending at periodEnd month
    const months = this.getLast12Months(targetYear, targetMonth);
    const twelveMonthStart = months[0].start;

    // Fetch sales invoices (12-month window for chart) + optionally with lines (period only)
    const [invoices, invoicesWithLines] = await Promise.all([
      this.safeGetSalesInvoices(twelveMonthStart, periodEnd, opts),
      this.safeGetSalesInvoicesWithLines(periodStart, periodEnd, opts),
    ]);

    if (!invoices) {
      return {
        period: { startDate: periodStart, endDate: periodEnd, year: targetYear, month: targetMonth },
        error: 'salesInvoices API not available',
        kpis: { totalSales: null, invoiceCount: null, avgInvoiceAmount: null, topCustomerName: null, topCustomerSales: null },
        charts: { salesByMonth: [], top5Customers: [], salesBySalesperson: [], topItems: [] },
      };
    }

    // Filter to requested period for KPIs
    const periodInvoices = invoices.filter(
      i => i.postingDate >= periodStart && i.postingDate <= periodEnd
    );

    // KPIs
    const totalSales = periodInvoices.reduce((s, i) => s + (i.totalAmountExcludingTax || 0), 0);
    const invoiceCount = periodInvoices.length;
    const avgInvoice = invoiceCount > 0 ? totalSales / invoiceCount : 0;

    const customerSales = this.groupBy(periodInvoices, 'customerName', 'totalAmountExcludingTax');
    const topCustomer = customerSales.length > 0 ? customerSales[0] : null;

    const kpis = {
      totalSales,
      invoiceCount,
      avgInvoiceAmount: avgInvoice,
      topCustomerName: topCustomer?.name || null,
      topCustomerSales: topCustomer?.value || null,
    };

    // Charts
    const salesByMonth = this.computeMonthlyTotals(invoices, months);
    const top5Customers = customerSales.slice(0, 5);
    const salesBySalesperson = this.groupBy(periodInvoices, 'salespersonCode', 'totalAmountExcludingTax')
      .filter(sp => sp.name && sp.name !== 'Unknown');

    // Optional: Top items from line-level data
    let topItems = [];
    if (invoicesWithLines) {
      topItems = this.computeTopItems(invoicesWithLines);
    }

    const result = {
      period: { startDate: periodStart, endDate: periodEnd, year: targetYear, month: targetMonth },
      kpis,
      charts: { salesByMonth, top5Customers, salesBySalesperson, topItems },
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
        .filter(i => i.postingDate >= start && i.postingDate <= end)
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

  computeTopItems(invoicesWithLines) {
    const itemMap = {};
    for (const inv of invoicesWithLines) {
      const lines = inv.salesInvoiceLines || [];
      for (const line of lines) {
        if (line.lineType === 'Item' || line.lineType === 'Resource') {
          const key = line.description || line.lineObjectNumber || 'Unknown';
          itemMap[key] = (itemMap[key] || 0) + (line.netAmount || 0);
        }
      }
    }
    return Object.entries(itemMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }

  async safeGetSalesInvoices(start, end, opts) {
    try {
      return await this.bc.getSalesInvoices(start, end, { companyId: opts.companyId });
    } catch (e) {
      console.error('[SalesDashboard] getSalesInvoices error:', e.message);
      return null;
    }
  }

  async safeGetSalesInvoicesWithLines(start, end, opts) {
    try {
      return await this.bc.getSalesInvoicesWithLines(start, end, { companyId: opts.companyId });
    } catch (e) {
      console.error('[SalesDashboard] getSalesInvoicesWithLines error:', e.message);
      return null;
    }
  }
}

module.exports = SalesDashboardService;
