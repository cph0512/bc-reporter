// src/services/forecastImporter.js
// Parses BBTruck P&L Forecast Excel files into cell-level forecastLines
// Preserves EVERY row and column from the original Excel for fine-grained editing

const XLSX = require('xlsx');

function parseCellDecimals(cell, fallback = 1) {
  const source = String(cell?.z || cell?.w || '');
  const dotMatch = source.match(/\.(0+|#+)/);
  if (dotMatch) return dotMatch[1].length;

  const textMatch = String(cell?.w || '').match(/\.(\d+)/);
  if (textMatch) return textMatch[1].length;

  return fallback;
}

function inferCellDisplayType(cell, label, unit) {
  const format = String(cell?.z || '');
  const text = String(cell?.w || '');
  const hint = `${label || ''} ${unit || ''}`;

  if (format.includes('%') || text.includes('%') || hint.includes('%')) return 'percent';
  if (/\b(NT\$|US\$|TWD|USD)\b/i.test(format) || /\b(NT\$|US\$|TWD|USD)\b/i.test(hint)) return 'currency';
  return 'number';
}

function readWorksheetCell(ws, rowIndex, colIndex, label, unit) {
  const ref = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
  const cell = ws[ref];
  if (!cell) return null;

  const rawValue = cell.v;
  let value = null;
  if (typeof rawValue === 'number') {
    value = rawValue;
  } else if (typeof rawValue === 'string' && rawValue.trim()) {
    const parsed = parseFloat(rawValue.replace(/,/g, ''));
    if (!Number.isNaN(parsed)) value = parsed;
  }

  if (value == null && !cell.f) return null;

  return {
    value,
    formula: cell.f || null,
    numberFormat: cell.z || null,
    formattedText: cell.w || null,
    displayType: inferCellDisplayType(cell, label, unit),
    decimals: parseCellDecimals(cell, (cell.z || '').includes('%') ? 1 : 1),
    rawType: cell.t || null,
    readOnly: Boolean(cell.f),
  };
}

/**
 * Parse a single sheet into raw grid format — every row, every cell preserved.
 * Returns { columns, rows } where:
 *   columns: [{ colIndex, header, periodKey }]  — column metadata
 *   rows:    [{ rowIndex, label, section, indent, isHeader, isSummary, cells: { periodKey: value } }]
 */
function parseSheetRaw(ws, sheetName) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (data.length < 4) return { columns: [], rows: [] };

  // ============================================================
  // STEP 1: Build column mapping from header rows
  // ============================================================
  const columns = [];

  if (sheetName === 'P&L Forecast' || !sheetName) {
    // P&L sheet: row 3 (0-indexed) has quarter labels + year labels
    const row3 = data[3] || [];

    // Annual columns (C-K, index 2-10)
    for (let c = 2; c <= 10; c++) {
      const val = row3[c];
      if (val && typeof val === 'number' && val >= 2020 && val <= 2040) {
        columns.push({ colIndex: c, header: `FY${val}`, periodKey: `${val}`, periodType: 'year' });
      }
    }

    // Quarterly columns (L onwards, index 11+)
    for (let c = 11; c < row3.length; c++) {
      const label = String(row3[c]).trim();
      if (!label) continue;
      const match = label.match(/^(\d)Q(\d{2})$/);
      if (match) {
        const q = match[1];
        const yr = parseInt(match[2], 10);
        const fullYear = yr >= 50 ? 1900 + yr : 2000 + yr;
        const periodKey = `${fullYear}-Q${q}`;
        columns.push({ colIndex: c, header: label, periodKey, periodType: 'quarter' });
      }
    }
  } else if (sheetName === 'KOMs') {
    // KOMs sheet: row 1 has years, row 2 has months
    const yearRow = data[1] || [];
    const monthRow = data[2] || [];
    for (let c = 3; c < yearRow.length; c++) {
      const yr = yearRow[c];
      const mo = monthRow[c];
      if (yr && mo && typeof yr === 'number' && typeof mo === 'number') {
        const periodKey = `${yr}-${String(mo).padStart(2, '0')}`;
        columns.push({ colIndex: c, header: `${yr}/${String(mo).padStart(2, '0')}`, periodKey, periodType: 'month' });
      }
    }
  }

  if (columns.length === 0) return { columns: [], rows: [] };

  // ============================================================
  // STEP 2: Parse every data row
  // ============================================================
  const rows = [];
  const startRow = sheetName === 'KOMs' ? 4 : 4; // skip header rows
  let currentSection = '';

  for (let r = startRow; r < data.length; r++) {
    const row = data[r];
    // Get label from col A (項目名稱) + col B (單位)
    // BBTruck P&L: col A = item name (總營收, 台灣...), col B = unit (NT$M, %, NT$)
    const colA = String(row[0] || '').trim();
    const colB = String(row[1] || '').trim();

    // Build label: prefer colA (item name), append unit from colB if it's a unit indicator
    const isUnit = /^(NT\$|US\$|%|KG|CBM|TWD|USD|元|M$)/i.test(colB);
    const label = colA ? (isUnit && colB ? `${colA} (${colB})` : colA) : colB;

    if (!label) continue; // skip empty rows

    // Detect section headers and hierarchy
    const isHeader = isSectionHeader(label, row, columns);
    const isSummary = isSummaryRow(label);
    const indent = getIndentLevel(label, colA, colB);

    // Track current section
    if (isHeader) currentSection = colA || label;

    // Extract cell values for every column
    const cells = {};
    let hasAnyValue = false;
    for (const col of columns) {
      const cellMeta = readWorksheetCell(ws, r, col.colIndex, label, colB);
      if (cellMeta) {
        cells[col.periodKey] = cellMeta;
        if (cellMeta.value !== null || cellMeta.formula) hasAnyValue = true;
      }
    }

    // Keep all rows (including headers for structure), but mark them
    rows.push({
      rowIndex: r,
      label: label.trim(),
      section: currentSection,
      indent,
      isHeader,
      isSummary,
      cells,
      hasData: hasAnyValue,
    });
  }

  return { columns, rows };
}


/**
 * Detect if a row is a section header (no numeric data, bold-style labels)
 */
function isSectionHeader(label, row, columns) {
  // A section header typically has text but no numeric values in data columns
  let hasNumeric = false;
  for (const col of columns) {
    if (typeof row[col.colIndex] === 'number') { hasNumeric = true; break; }
  }
  if (hasNumeric) return false;

  // Common section header patterns
  const headerPatterns = [
    /^(revenue|營收|收入)\s*$/i,
    /^(gross\s*profit|毛利)/i,
    /^(operating|營業)/i,
    /^(expense|費用)/i,
    /^(台灣|北美|新加坡|Total)/,
    /^(卡車|跨境|終端|軟體|倉儲)/,
    /by\s+(market|business|region)/i,
  ];
  return headerPatterns.some(p => p.test(label));
}

/**
 * Detect summary/total rows
 */
function isSummaryRow(label) {
  return /total|合計|小計|^total\s/i.test(label);
}

/**
 * Get indent level based on position
 */
function getIndentLevel(label, colA, colB) {
  if (colA && colB) return 0; // Both columns filled = top-level
  if (!colA && colB) return 1; // Only col B = sub-item
  if (label.startsWith('　') || label.startsWith('  ')) return 2; // Indented
  return 0;
}


/**
 * Main entry: parse a forecast Excel buffer into raw grid format.
 * Returns { sheets: [{ name, columns, rows }], summary }
 */
function parseForcastExcel(buffer, fileName) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellNF: true, cellText: true });
  const result = {
    sheets: [],
    allLines: [],  // backward-compatible flattened format
    pnlLines: [],
    komLines: [],
    summary: { sheets: wb.SheetNames, pnlCount: 0, komCount: 0, totalCount: 0 },
  };

  // Parse each known sheet
  const pnlSheet = wb.Sheets['P&L Forecast'] || wb.Sheets[wb.SheetNames[0]];
  if (pnlSheet) {
    const parsed = parseSheetRaw(pnlSheet, 'P&L Forecast');
    parsed.name = 'P&L Forecast';
    result.sheets.push(parsed);

    // Convert to flat forecastLines for backward compatibility
    const lines = gridToForecastLines(parsed, 'pnl');
    result.pnlLines = lines;
    result.summary.pnlCount = lines.length;
  }

  const komSheet = wb.Sheets['KOMs'];
  if (komSheet) {
    const parsed = parseSheetRaw(komSheet, 'KOMs');
    parsed.name = 'KOMs';
    result.sheets.push(parsed);

    const lines = gridToForecastLines(parsed, 'kom');
    result.komLines = lines;
    result.summary.komCount = lines.length;
  }

  // Also parse any other sheets
  for (const sn of wb.SheetNames) {
    if (sn === 'P&L Forecast' || sn === 'KOMs') continue;
    const ws = wb.Sheets[sn];
    if (ws) {
      const parsed = parseSheetRaw(ws, sn);
      if (parsed.rows.length > 0) {
        parsed.name = sn;
        result.sheets.push(parsed);
      }
    }
  }

  result.allLines = [...result.pnlLines, ...result.komLines];
  result.allLines._fileName = fileName || 'unknown.xlsx';
  result.summary.totalCount = result.allLines.length;

  return result;
}


/**
 * Convert raw grid to flat forecastLines (backward compatible).
 * Each data row × period becomes one forecastLine with the original label preserved.
 */
function gridToForecastLines(grid, source) {
  const lines = [];
  for (const row of grid.rows) {
    if (!row.hasData) continue; // skip header-only rows

    // Group cells by period type
    const byType = {};
    for (const [periodKey, cell] of Object.entries(row.cells)) {
      const col = grid.columns.find(c => c.periodKey === periodKey);
      const periodType = col?.periodType || 'quarter';
      if (!byType[periodType]) byType[periodType] = {};
      byType[periodType][periodKey] = cell;
    }

    for (const [periodType, periods] of Object.entries(byType)) {
      for (const [periodKey, cell] of Object.entries(periods)) {
        const value = cell?.value ?? null;
        lines.push({
          rowLabel: row.label,
          rowIndex: row.rowIndex,
          section: row.section,
          indent: row.indent,
          isHeader: row.isHeader,
          isSummary: row.isSummary,
          source,
          periodType,
          periodKey,
          value,
          formula: cell?.formula || null,
          numberFormat: cell?.numberFormat || null,
          formattedText: cell?.formattedText || null,
          displayType: cell?.displayType || 'number',
          decimals: cell?.decimals ?? 1,
          readOnly: Boolean(cell?.readOnly),
          // Legacy compatibility fields
          market: 'Total',
          businessModel: 'Total',
          metrics: { [sanitizeMetricKey(row.label)]: value },
        });
      }
    }
  }
  return lines;
}

/**
 * Create a metric key from a label
 */
function sanitizeMetricKey(label) {
  return label
    .replace(/[（(].*[)）]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\w\u4e00-\u9fff]/g, '')
    .toLowerCase()
    .slice(0, 50) || 'value';
}


/**
 * Extract scenario metadata from the Excel
 */
function extractScenarioMeta(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellNF: true, cellText: true });
  const pnlSheet = wb.Sheets['P&L Forecast'] || wb.Sheets[wb.SheetNames[0]];
  if (!pnlSheet) return null;

  const data = XLSX.utils.sheet_to_json(pnlSheet, { header: 1, defval: '' });
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
  parseSheetRaw,
  gridToForecastLines,
  extractScenarioMeta,
};
