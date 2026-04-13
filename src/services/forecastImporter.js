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

  // === Helper to push lines for both quarterly and annual ===
  function pushLines(market, businessModel, metricName, rowIdx) {
    if (!data[rowIdx]) return;
    const qValues = extractQuarterly(data[rowIdx]);
    for (const [pk, val] of Object.entries(qValues)) {
      lines.push({ market, businessModel, periodType: 'quarter', periodKey: pk,
        metrics: { [metricName]: val }, _row: rowIdx, _label: metricName });
    }
    const aValues = extractAnnual(data[rowIdx]);
    for (const [pk, val] of Object.entries(aValues)) {
      lines.push({ market, businessModel, periodType: 'year', periodKey: pk,
        metrics: { [metricName]: val }, _row: rowIdx, _label: metricName });
    }
  }

  // === Parse ALL key rows from the P&L Forecast sheet ===
  // Top-level P&L summary (rows 4-51)
  pushLines('Total', 'Total', 'revenue', 4);
  pushLines('Total', 'Total', 'grossProfit', 33);
  pushLines('Total', 'Total', 'grossMargin', 34);
  pushLines('Total', 'Total', 'opex', 36);
  pushLines('Total', 'Total', 'rd', 37);
  pushLines('Total', 'Total', 'sm', 38);
  pushLines('Total', 'Total', 'ga', 39);
  pushLines('Total', 'Total', 'opexRatio', 41);
  pushLines('Total', 'Total', 'operatingProfit', 46);
  pushLines('Total', 'Total', 'operatingMargin', 47);
  pushLines('Total', 'Total', 'netIncome', 51);
  pushLines('Total', 'Total', 'netMargin', 52);

  // Revenue by market (rows 9-11)
  pushLines('台灣', 'Total', 'revenue', 9);
  pushLines('北美', 'Total', 'revenue', 10);
  pushLines('新加坡', 'Total', 'revenue', 11);

  // Revenue by business model (rows 20-24)
  pushLines('Total', '卡車運輸', 'revenue', 20);
  pushLines('Total', '跨境物流', 'revenue', 21);
  pushLines('Total', '終端配送', 'revenue', 22);
  pushLines('Total', '軟體服務', 'revenue', 23);
  pushLines('Total', '倉儲', 'revenue', 24);

  // === Detailed breakdown: each biz model → market → revenue/cogs/grossProfit ===

  // 卡車運輸 (rows 54-90)
  pushLines('Total', '卡車運輸', 'grossProfit', 56);
  pushLines('Total', '卡車運輸', 'grossMargin', 57);
  // 台灣
  pushLines('台灣', '卡車運輸', 'activeCustomers', 59);
  pushLines('台灣', '卡車運輸', 'totalOrders', 60);
  pushLines('台灣', '卡車運輸', 'revenue', 61);
  pushLines('台灣', '卡車運輸', 'cogs', 62);
  pushLines('台灣', '卡車運輸', 'grossProfit', 63);
  pushLines('台灣', '卡車運輸', 'grossMargin', 64);
  // 北美
  pushLines('北美', '卡車運輸', 'activeCustomers', 71);
  pushLines('北美', '卡車運輸', 'totalOrders', 72);
  pushLines('北美', '卡車運輸', 'revenue', 73);
  pushLines('北美', '卡車運輸', 'cogs', 74);
  pushLines('北美', '卡車運輸', 'grossProfit', 75);
  pushLines('北美', '卡車運輸', 'grossMargin', 76);
  // 新加坡
  pushLines('新加坡', '卡車運輸', 'activeCustomers', 82);
  pushLines('新加坡', '卡車運輸', 'totalOrders', 83);
  pushLines('新加坡', '卡車運輸', 'revenue', 84);
  pushLines('新加坡', '卡車運輸', 'cogs', 85);
  pushLines('新加坡', '卡車運輸', 'grossProfit', 86);
  pushLines('新加坡', '卡車運輸', 'grossMargin', 87);

  // 跨境物流 (rows 93-135)
  pushLines('Total', '跨境物流', 'grossProfit', 95);
  pushLines('Total', '跨境物流', 'grossMargin', 96);
  // 台灣
  pushLines('台灣', '跨境物流', 'activeCustomers', 98);
  pushLines('台灣', '跨境物流', 'totalOrders', 99);
  pushLines('台灣', '跨境物流', 'revenue', 101);
  pushLines('台灣', '跨境物流', 'cogs', 102);
  pushLines('台灣', '跨境物流', 'grossProfit', 103);
  // 北美
  pushLines('北美', '跨境物流', 'activeCustomers', 111);
  pushLines('北美', '跨境物流', 'totalOrders', 112);
  pushLines('北美', '跨境物流', 'revenue', 114);
  pushLines('北美', '跨境物流', 'cogs', 115);
  pushLines('北美', '跨境物流', 'grossProfit', 116);

  // 終端配送 (rows 138-173)
  pushLines('Total', '終端配送', 'grossProfit', 140);
  pushLines('Total', '終端配送', 'grossMargin', 141);
  // 台灣
  pushLines('台灣', '終端配送', 'activeCustomers', 143);
  pushLines('台灣', '終端配送', 'revenue', 145);
  pushLines('台灣', '終端配送', 'cogs', 146);
  pushLines('台灣', '終端配送', 'grossProfit', 147);
  // 北美
  pushLines('北美', '終端配送', 'activeCustomers', 154);
  pushLines('北美', '終端配送', 'revenue', 156);
  pushLines('北美', '終端配送', 'cogs', 157);
  pushLines('北美', '終端配送', 'grossProfit', 158);
  // 新加坡
  pushLines('新加坡', '終端配送', 'activeCustomers', 165);
  pushLines('新加坡', '終端配送', 'revenue', 167);
  pushLines('新加坡', '終端配送', 'cogs', 168);
  pushLines('新加坡', '終端配送', 'grossProfit', 169);

  // 軟體服務 (rows 176-235)
  pushLines('Total', '軟體服務', 'grossProfit', 178);
  pushLines('Total', '軟體服務', 'grossMargin', 179);
  // 台灣
  pushLines('台灣', '軟體服務', 'revenue', 194);
  pushLines('台灣', '軟體服務', 'cogs', 195);
  pushLines('台灣', '軟體服務', 'grossProfit', 196);
  // 北美
  pushLines('北美', '軟體服務', 'revenue', 213);
  pushLines('北美', '軟體服務', 'cogs', 214);
  pushLines('北美', '軟體服務', 'grossProfit', 215);

  // 倉儲 (rows 238-275)
  pushLines('Total', '倉儲', 'grossProfit', 240);
  pushLines('Total', '倉儲', 'grossMargin', 241);
  // 台灣
  pushLines('台灣', '倉儲', 'activeCustomers', 243);
  pushLines('台灣', '倉儲', 'revenue', 246);
  pushLines('台灣', '倉儲', 'cogs', 250);
  pushLines('台灣', '倉儲', 'grossProfit', 251);
  // 北美
  pushLines('北美', '倉儲', 'activeCustomers', 262);
  pushLines('北美', '倉儲', 'revenue', 265);
  pushLines('北美', '倉儲', 'cogs', 269);
  pushLines('北美', '倉儲', 'grossProfit', 270);

  // === Merge lines with same market+biz+period into single objects ===
  const merged = {};
  for (const line of lines) {
    const key = `${line.market}|${line.businessModel}|${line.periodType}|${line.periodKey}`;
    if (!merged[key]) {
      merged[key] = { market: line.market, businessModel: line.businessModel, periodType: line.periodType, periodKey: line.periodKey, metrics: {} };
    }
    Object.assign(merged[key].metrics, line.metrics);
  }

  return Object.values(merged);
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
