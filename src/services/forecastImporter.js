// src/services/forecastImporter.js
// Parses BBTruck P&L Forecast Excel files into standardized forecastLines
// Supports the specific format of BBTruck P_L Forecast_v3.xlsx

const XLSX = require('xlsx');

/**
 * Parse P&L Forecast sheet — quarterly data by market and business model
 * Structure:
 *   Row 1: "Year" header with years
 *   Row 2: "Month" header (actually year labels for quarters)
 *   Row 3: Quarter labels (1Q22, 2Q22, ..., 4Q30)
 *   Row 4+: Data rows with label in col B, values in cols L-AW (quarters)
 */
function parsePnLSheet(ws) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const lines = [];

  // Parse quarter column mapping from row 3 (0-indexed)
  // Columns L onwards (index 11+) are quarterly: 1Q22, 2Q22, ...
  const quarterRow = data[3] || [];
  const quarterMap = {}; // colIndex -> periodKey like "2026-Q1"
  for (let c = 11; c < quarterRow.length; c++) {
    const label = String(quarterRow[c]).trim();
    if (!label) continue;
    // Parse "1Q26" → "2026-Q1"
    const match = label.match(/^(\d)Q(\d{2})$/);
    if (match) {
      const q = match[1];
      const yr = parseInt(match[2], 10);
      const fullYear = yr >= 50 ? 1900 + yr : 2000 + yr;
      quarterMap[c] = `${fullYear}-Q${q}`;
    }
  }

  // Also parse annual columns from row 3 (cols C-K, index 2-10)
  const annualMap = {}; // colIndex -> year string
  for (let c = 2; c <= 10; c++) {
    const val = data[3] ? data[3][c] : '';
    if (val && typeof val === 'number' && val >= 2020 && val <= 2035) {
      annualMap[c] = String(val);
    }
  }

  // Helper to extract quarterly values for a row
  function extractQuarterly(row) {
    const values = {};
    for (const [colStr, periodKey] of Object.entries(quarterMap)) {
      const col = parseInt(colStr, 10);
      const val = row[col];
      if (val !== '' && val !== null && val !== undefined && typeof val === 'number') {
        values[periodKey] = val;
      }
    }
    return values;
  }

  // Helper to extract annual values
  function extractAnnual(row) {
    const values = {};
    for (const [colStr, year] of Object.entries(annualMap)) {
      const col = parseInt(colStr, 10);
      const val = row[col];
      if (val !== '' && val !== null && val !== undefined && typeof val === 'number') {
        values[year] = val;
      }
    }
    return values;
  }

  // === Parse key rows ===
  // Row indices (0-based) from the actual Excel:
  const ROW_MAP = {
    // Revenue by market
    totalRevenue: 4,
    tw_revenue: 9,
    na_revenue: 10,
    sg_revenue: 11,
    // Revenue by business model
    trucking_revenue: 20,
    crossborder_revenue: 21,
    lastmile_revenue: 22,
    software_revenue: 23,
    warehouse_revenue: 24,
    // Financials
    totalGrossProfit: 33,
    totalOpex: 36,
    rd_expense: 37,
    sm_expense: 38,
    ga_expense: 39,
    operatingProfit: 46,
    netIncome: 51,
  };

  // Market revenue rows
  const marketRows = [
    { row: ROW_MAP.tw_revenue, market: '台灣' },
    { row: ROW_MAP.na_revenue, market: '北美' },
    { row: ROW_MAP.sg_revenue, market: '新加坡' },
  ];

  // Business model revenue rows
  const bizRows = [
    { row: ROW_MAP.trucking_revenue, biz: '卡車運輸' },
    { row: ROW_MAP.crossborder_revenue, biz: '跨境物流' },
    { row: ROW_MAP.lastmile_revenue, biz: '終端配送' },
    { row: ROW_MAP.software_revenue, biz: '軟體服務' },
    { row: ROW_MAP.warehouse_revenue, biz: '倉儲' },
  ];

  // Extract total-level quarterly data
  const totalRevenueQ = extractQuarterly(data[ROW_MAP.totalRevenue] || []);
  const totalGrossProfitQ = extractQuarterly(data[ROW_MAP.totalGrossProfit] || []);
  const totalOpexQ = extractQuarterly(data[ROW_MAP.totalOpex] || []);
  const operatingProfitQ = extractQuarterly(data[ROW_MAP.operatingProfit] || []);

  // Build total-level forecast lines (quarterly)
  for (const periodKey of Object.keys(totalRevenueQ)) {
    lines.push({
      market: 'Total',
      businessModel: 'Total',
      periodType: 'quarter',
      periodKey,
      metrics: {
        revenue: totalRevenueQ[periodKey] || 0,
        grossProfit: totalGrossProfitQ[periodKey] || 0,
        opex: totalOpexQ[periodKey] || 0,
        operatingProfit: operatingProfitQ[periodKey] || 0,
      },
    });
  }

  // Extract total-level annual data
  const totalRevenueA = extractAnnual(data[ROW_MAP.totalRevenue] || []);
  const totalGrossProfitA = extractAnnual(data[ROW_MAP.totalGrossProfit] || []);
  const totalOpexA = extractAnnual(data[ROW_MAP.totalOpex] || []);
  const operatingProfitA = extractAnnual(data[ROW_MAP.operatingProfit] || []);
  const netIncomeA = extractAnnual(data[ROW_MAP.netIncome] || []);

  for (const year of Object.keys(totalRevenueA)) {
    lines.push({
      market: 'Total',
      businessModel: 'Total',
      periodType: 'year',
      periodKey: year,
      metrics: {
        revenue: totalRevenueA[year] || 0,
        grossProfit: totalGrossProfitA[year] || 0,
        opex: totalOpexA[year] || 0,
        operatingProfit: operatingProfitA[year] || 0,
        netIncome: netIncomeA[year] || 0,
      },
    });
  }

  // Market-level quarterly
  for (const { row, market } of marketRows) {
    const qValues = extractQuarterly(data[row] || []);
    for (const [periodKey, revenue] of Object.entries(qValues)) {
      lines.push({
        market,
        businessModel: 'Total',
        periodType: 'quarter',
        periodKey,
        metrics: { revenue },
      });
    }
    // Annual
    const aValues = extractAnnual(data[row] || []);
    for (const [year, revenue] of Object.entries(aValues)) {
      lines.push({
        market,
        businessModel: 'Total',
        periodType: 'year',
        periodKey: year,
        metrics: { revenue },
      });
    }
  }

  // Business model quarterly
  for (const { row, biz } of bizRows) {
    const qValues = extractQuarterly(data[row] || []);
    for (const [periodKey, revenue] of Object.entries(qValues)) {
      lines.push({
        market: 'Total',
        businessModel: biz,
        periodType: 'quarter',
        periodKey,
        metrics: { revenue },
      });
    }
    // Annual
    const aValues = extractAnnual(data[row] || []);
    for (const [year, revenue] of Object.entries(aValues)) {
      lines.push({
        market: 'Total',
        businessModel: biz,
        periodType: 'year',
        periodKey: year,
        metrics: { revenue },
      });
    }
  }

  return lines;
}

/**
 * Parse KOMs sheet — monthly operational data per market per business model
 * Structure:
 *   Row 1: "Year" with year values
 *   Row 2: "Month" with 1-12
 *   Row 3: Serial date numbers (Excel date serials)
 *   Rows 4+: Sections per market per business model with metrics
 */
function parseKOMsSheet(ws) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const lines = [];

  // Parse month column mapping from rows 1-2
  const yearRow = data[1] || [];
  const monthRow = data[2] || [];
  const monthMap = {}; // colIndex -> "2026-01"
  for (let c = 3; c < yearRow.length; c++) {
    const yr = yearRow[c];
    const mo = monthRow[c];
    if (yr && mo && typeof yr === 'number' && typeof mo === 'number') {
      monthMap[c] = `${yr}-${String(mo).padStart(2, '0')}`;
    }
  }

  function extractMonthly(row) {
    const values = {};
    for (const [colStr, periodKey] of Object.entries(monthMap)) {
      const col = parseInt(colStr, 10);
      const val = row[col];
      if (val !== '' && val !== null && val !== undefined && typeof val === 'number') {
        values[periodKey] = val;
      }
    }
    return values;
  }

  // Scan for section headers and data rows
  // Pattern: sections are structured as:
  //   "台灣" / "北美" / "新加坡" — market header
  //   "活躍企業客戶數" — metric rows
  //   "當月總訂單量"
  //   "營收"
  //   "成本(COGS)"
  //   "毛利"
  //   "毛利率"

  let currentMarket = null;
  let currentBiz = null;

  // Known market labels
  const marketLabels = { '台灣': '台灣', '北美': '北美', '新加坡': '新加坡' };
  // Known biz model section labels
  const bizLabels = {
    '卡車運輸 (Truckloads)': '卡車運輸',
    '跨境物流': '跨境物流',
    '終端配送': '終端配送',
    '軟體服務': '軟體服務',
    '倉儲': '倉儲',
  };

  // Metric row label mapping
  const metricLabels = {
    '活躍企業客戶數': 'activeCustomers',
    '活躍企業客戶數 - 期末數': 'activeCustomers',
    '當月總訂單量': 'totalOrders',
    '當期總訂單量': 'totalOrders',
    '營收': 'revenue',
    '成本(COGS)': 'cogs',
    '毛利': 'grossProfit',
    '毛利率': 'grossMargin',
    '每間企業平均月訂單量': 'avgOrdersPerCustomer',
    '平均每單運費': 'avgOrderValue',
  };

  // Collect metrics per market+biz+month, then combine into lines
  const collected = {}; // key: market|biz|month -> metrics object

  for (let r = 4; r < data.length; r++) {
    const row = data[r];
    const col0 = String(row[0] || '').trim();
    const col1 = String(row[1] || '').trim();

    // Check for biz model section header (col1)
    if (bizLabels[col1]) {
      currentBiz = bizLabels[col1];
      currentMarket = null; // reset, will be set by sub-section
      continue;
    }

    // Check for market label (col1)
    if (marketLabels[col1]) {
      currentMarket = marketLabels[col1];
      continue;
    }

    // Check for metric row (col1)
    const metricKey = metricLabels[col1];
    if (metricKey && currentMarket && currentBiz) {
      const monthValues = extractMonthly(row);
      for (const [month, val] of Object.entries(monthValues)) {
        const key = `${currentMarket}|${currentBiz}|${month}`;
        if (!collected[key]) collected[key] = {};
        collected[key][metricKey] = val;
      }
    }
  }

  // Convert collected data to forecast lines
  for (const [key, metrics] of Object.entries(collected)) {
    const [market, businessModel, periodKey] = key.split('|');
    // Skip if no meaningful data
    if (Object.values(metrics).every(v => v === 0 || v === '')) continue;
    lines.push({
      market,
      businessModel,
      periodType: 'month',
      periodKey,
      metrics,
    });
  }

  return lines;
}

/**
 * Main entry: parse a forecast Excel buffer
 * Returns { pnlLines, komLines, summary }
 */
function parseForcastExcel(buffer, fileName) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const result = {
    pnlLines: [],
    komLines: [],
    allLines: [],
    summary: { sheets: wb.SheetNames, pnlCount: 0, komCount: 0, totalCount: 0 },
  };

  // Parse P&L Forecast sheet
  const pnlSheet = wb.Sheets['P&L Forecast'] || wb.Sheets[wb.SheetNames[0]];
  if (pnlSheet) {
    result.pnlLines = parsePnLSheet(pnlSheet);
    result.summary.pnlCount = result.pnlLines.length;
  }

  // Parse KOMs sheet
  const komSheet = wb.Sheets['KOMs'] || wb.Sheets[wb.SheetNames[1]];
  if (komSheet && wb.SheetNames.includes('KOMs')) {
    result.komLines = parseKOMsSheet(komSheet);
    result.summary.komCount = result.komLines.length;
  }

  result.allLines = [...result.pnlLines, ...result.komLines];
  result.allLines._fileName = fileName || 'unknown.xlsx';
  result.summary.totalCount = result.allLines.length;

  return result;
}

/**
 * Extract scenario metadata from the Excel (markets, business models, periods)
 */
function extractScenarioMeta(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const pnlSheet = wb.Sheets['P&L Forecast'] || wb.Sheets[wb.SheetNames[0]];
  if (!pnlSheet) return null;

  const data = XLSX.utils.sheet_to_json(pnlSheet, { header: 1, defval: '' });

  // Get year range from row 3
  const years = [];
  const row3 = data[3] || [];
  for (let c = 2; c <= 10; c++) {
    if (row3[c] && typeof row3[c] === 'number') years.push(row3[c]);
  }

  return {
    markets: ['台灣', '北美', '新加坡'],
    businessModels: ['卡車運輸', '跨境物流', '終端配送', '軟體服務', '倉儲'],
    startPeriod: years.length ? String(Math.min(...years)) : '2022',
    endPeriod: years.length ? String(Math.max(...years)) : '2030',
    sheets: wb.SheetNames,
  };
}

module.exports = {
  parseForcastExcel,
  parsePnLSheet,
  parseKOMsSheet,
  extractScenarioMeta,
};
