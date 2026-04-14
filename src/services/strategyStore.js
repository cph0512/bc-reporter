// src/services/strategyStore.js
// JSON-file backed strategy store for scenarios, forecast lines, KPIs, strategies
// Follows same pattern as pipelineStore.js

const fs = require('fs');
const path = require('path');
const { resolveDataFile } = require('./dataDir');

const STRATEGY_FILE = resolveDataFile('strategy.json');

const DEFAULT_DATA = {
  scenarios: [],
  forecastLines: [],
  forecastWorkbooks: [],
  kpiDefinitions: [],
  strategies: [],
  importHistory: [],
  auditLog: [],
};

let strategyDataCache = {
  mtimeMs: null,
  data: null,
};

function normalizeData(raw = {}) {
  return {
    scenarios: raw.scenarios || [],
    forecastLines: raw.forecastLines || [],
    forecastWorkbooks: raw.forecastWorkbooks || [],
    kpiDefinitions: raw.kpiDefinitions || [],
    strategies: raw.strategies || [],
    importHistory: raw.importHistory || [],
    auditLog: raw.auditLog || [],
  };
}

function readData() {
  try {
    if (!fs.existsSync(STRATEGY_FILE)) {
      strategyDataCache = { mtimeMs: null, data: normalizeData(DEFAULT_DATA) };
      return strategyDataCache.data;
    }

    const stats = fs.statSync(STRATEGY_FILE);
    if (strategyDataCache.data && strategyDataCache.mtimeMs === stats.mtimeMs) {
      return strategyDataCache.data;
    }

    const raw = JSON.parse(fs.readFileSync(STRATEGY_FILE, 'utf8'));
    strategyDataCache = {
      mtimeMs: stats.mtimeMs,
      data: normalizeData(raw),
    };
    return strategyDataCache.data;
  } catch {
    strategyDataCache = { mtimeMs: null, data: normalizeData(DEFAULT_DATA) };
    return strategyDataCache.data;
  }
}

function writeData(data) {
  const dir = path.dirname(STRATEGY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STRATEGY_FILE, JSON.stringify(data, null, 2), 'utf8');
  try {
    const stats = fs.statSync(STRATEGY_FILE);
    strategyDataCache = {
      mtimeMs: stats.mtimeMs,
      data,
    };
  } catch {
    strategyDataCache = { mtimeMs: null, data };
  }
}

function nextId(arr, prefix) {
  const max = arr.reduce((m, item) => {
    const n = parseInt(item.id.replace(`${prefix}_`, ''), 10);
    return n > m ? n : m;
  }, 0);
  return `${prefix}_${max + 1}`;
}

function addAudit(data, { action, entity, entityId, detail, userId, oldValue, newValue }) {
  data.auditLog.push({
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    action,
    entity,
    entityId,
    detail,
    userId: userId || 'system',
    timestamp: new Date().toISOString(),
    // For revert: store old/new values
    oldValue: oldValue || null,
    newValue: newValue || null,
  });
  // Keep last 1000 audit entries
  if (data.auditLog.length > 1000) {
    data.auditLog = data.auditLog.slice(-1000);
  }
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeNumericValue(value) {
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(num)) throw new Error('數值格式不正確');
  return num;
}

function buildForecastLineLabel(line) {
  return line.rowLabel || [line.market, line.businessModel].filter(Boolean).join(' / ') || 'Untitled row';
}

function buildForecastLineAuditValue(line) {
  return {
    value: line.value ?? null,
    formula: line.formula || null,
    numberFormat: line.numberFormat || null,
    displayType: line.displayType || 'number',
    formattedText: line.formattedText || null,
    metrics: cloneJson(line.metrics || {}),
    rowLabel: line.rowLabel || '',
    section: line.section || '',
    indent: line.indent || 0,
  };
}

function inferDisplayTypeFromLine(line) {
  if (line.displayType) return line.displayType;
  if (String(line.numberFormat || '').includes('%')) return 'percent';
  if (/(\%)/.test(line.rowLabel || '')) return 'percent';
  if (/\b(NT\$|US\$|TWD|USD)\b/i.test(`${line.rowLabel || ''} ${line.numberFormat || ''}`)) return 'currency';
  return 'number';
}

function normalizeWorkbookCellData(cell = {}, fallback = {}) {
  return {
    id: cell.id || fallback.id || null,
    value: cell.value ?? fallback.value ?? null,
    formula: cell.formula || fallback.formula || null,
    numberFormat: cell.numberFormat || fallback.numberFormat || null,
    formattedText: cell.formattedText || fallback.formattedText || null,
    displayType: cell.displayType || fallback.displayType || 'number',
    decimals: cell.decimals ?? fallback.decimals ?? 1,
    rawType: cell.rawType || fallback.rawType || null,
    readOnly: cell.readOnly ?? fallback.readOnly ?? Boolean(cell.formula || fallback.formula),
  };
}

function updateWorkbookCellValue(cell, nextValue) {
  cell.value = nextValue;
  cell.formattedText = null;
  if (!cell.formula) cell.readOnly = false;
}

function inferMetricValue(update) {
  if (update.value !== undefined) return normalizeNumericValue(update.value);

  if (update.metrics && typeof update.metrics === 'object') {
    const firstNumeric = Object.values(update.metrics).find(v => typeof v === 'number' && !Number.isNaN(v));
    if (firstNumeric !== undefined) return firstNumeric;
  }

  return 0;
}

function inferPeriodType(periodKey, fallback = 'quarter') {
  if (!periodKey) return fallback;
  if (/^\d{4}-Q[1-4]$/.test(periodKey)) return 'quarter';
  if (/^\d{4}-\d{2}$/.test(periodKey)) return 'month';
  if (/^\d{4}$/.test(periodKey)) return 'year';
  return fallback;
}

function nextForecastLineId(data) {
  const max = data.forecastLines.reduce((m, fl) => {
    const n = parseInt(fl.id.replace('fl_', ''), 10);
    return n > m ? n : m;
  }, 0);
  return `fl_${max + 1}`;
}

function markScenarioUpdated(data, scenarioId, now) {
  const scenario = data.scenarios.find(item => item.id === scenarioId);
  if (scenario) scenario.updatedAt = now || new Date().toISOString();
  return scenario || null;
}

function sanitizeMetricKey(label) {
  return String(label || '')
    .replace(/[（(].*[)）]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\w\u4e00-\u9fff]/g, '')
    .toLowerCase()
    .slice(0, 50) || 'value';
}

function inferSheetNameFromLine(line) {
  if (line.sheetName) return line.sheetName;
  if (line.source === 'kom') return 'KOMs';
  return 'P&L Forecast';
}

function inferSourceFromSheetName(sheetName) {
  return sheetName === 'KOMs' ? 'kom' : 'pnl';
}

function buildWorkbookRowKey(row) {
  if (row.rowIndex != null) return `r${row.rowIndex}`;
  return row.label || row.rowLabel || `row_${Math.random().toString(36).slice(2, 8)}`;
}

function periodSortValue(periodKey) {
  if (/^\d{4}$/.test(periodKey)) return Number(periodKey) * 100;

  const quarterMatch = periodKey.match(/^(\d{4})-Q([1-4])$/);
  if (quarterMatch) return Number(quarterMatch[1]) * 100 + Number(quarterMatch[2]) * 10;

  const monthMatch = periodKey.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) return Number(monthMatch[1]) * 100 + Number(monthMatch[2]);

  return Number.MAX_SAFE_INTEGER;
}

function sortPeriodKeys(a, b) {
  return periodSortValue(a.periodKey || a) - periodSortValue(b.periodKey || b);
}

function findWorkbookCell(workbook, lineId) {
  if (!workbook?.sheets) return null;
  for (const sheet of workbook.sheets) {
    for (const row of sheet.rows || []) {
      for (const [periodKey, cell] of Object.entries(row.cells || {})) {
        if (cell?.id === lineId) {
          return { sheet, row, periodKey, cell };
        }
      }
    }
  }
  return null;
}

function buildWorkbookFromLines(lines, scenarioId) {
  const sheets = [];
  const sheetMap = new Map();

  for (const line of lines) {
    const sheetName = inferSheetNameFromLine(line);
    if (!sheetMap.has(sheetName)) {
      const sheet = {
        id: `sht_${sheetMap.size + 1}`,
        name: sheetName,
        source: line.source || inferSourceFromSheetName(sheetName),
        columns: [],
        rows: [],
      };
      sheet._columns = new Map();
      sheet._rows = new Map();
      sheetMap.set(sheetName, sheet);
      sheets.push(sheet);
    }

    const sheet = sheetMap.get(sheetName);
    if (!sheet._columns.has(line.periodKey)) {
      sheet._columns.set(line.periodKey, {
        id: `${sheet.id}_col_${line.periodKey.replace(/[^\w]/g, '_')}`,
        header: line.periodKey,
        periodKey: line.periodKey,
        periodType: line.periodType || inferPeriodType(line.periodKey),
      });
    }

    const rowKey = line.rowIndex != null ? `r${line.rowIndex}` : line.rowLabel;
    if (!sheet._rows.has(rowKey)) {
      sheet._rows.set(rowKey, {
        id: `${sheet.id}_row_${sheet._rows.size + 1}`,
        rowIndex: line.rowIndex ?? null,
        label: line.rowLabel || buildForecastLineLabel(line),
        section: line.section || '',
        indent: line.indent || 0,
        isHeader: line.isHeader || false,
        isSummary: line.isSummary || false,
        cells: {},
      });
    }

    const row = sheet._rows.get(rowKey);
    row.cells[line.periodKey] = normalizeWorkbookCellData({
      id: line.id,
      value: line.value ?? Object.values(line.metrics || {})[0] ?? null,
      formula: line.formula || null,
      numberFormat: line.numberFormat || null,
      formattedText: line.formattedText || null,
      displayType: inferDisplayTypeFromLine(line),
      decimals: line.decimals ?? 1,
      readOnly: line.readOnly ?? Boolean(line.formula),
    });
  }

  return {
    scenarioId,
    draft: {
      sheets: sheets.map(sheet => ({
        id: sheet.id,
        name: sheet.name,
        source: sheet.source,
        columns: [...sheet._columns.values()].sort(sortPeriodKeys),
        rows: [...sheet._rows.values()].sort((a, b) => (a.rowIndex ?? 99999) - (b.rowIndex ?? 99999)),
      })),
      updatedAt: new Date().toISOString(),
      updatedBy: 'system',
    },
    published: null,
    publishedMeta: null,
  };
}

function buildWorkbookDraftFromParsedSheets(data, scenarioId, parsedSheets, meta = {}) {
  let counter = data.forecastLines.reduce((m, fl) => {
    const n = parseInt(fl.id.replace('fl_', ''), 10);
    return n > m ? n : m;
  }, 0);

  const sheets = parsedSheets.map((parsedSheet, index) => {
    const sheetId = `sht_${index + 1}`;
    const columns = (parsedSheet.columns || []).map((column, colIndex) => ({
      id: `${sheetId}_col_${colIndex + 1}`,
      header: column.header || column.periodKey || `Col ${colIndex + 1}`,
      periodKey: column.periodKey,
      periodType: column.periodType || inferPeriodType(column.periodKey),
      colIndex: column.colIndex ?? null,
    }));

    const rows = (parsedSheet.rows || []).map((row, rowIndex) => {
      const rowId = `${sheetId}_row_${rowIndex + 1}`;
      const cells = {};

      for (const column of columns) {
        if (row.isHeader && !row.cells?.[column.periodKey]) continue;
        cells[column.periodKey] = normalizeWorkbookCellData({
          id: `fl_${++counter}`,
          ...(row.cells?.[column.periodKey] || {}),
        }, {
          displayType: 'number',
          decimals: 1,
        });
      }

      return {
        id: rowId,
        rowIndex: row.rowIndex ?? rowIndex,
        label: row.label || '',
        section: row.section || '',
        indent: row.indent || 0,
        isHeader: row.isHeader || false,
        isSummary: row.isSummary || false,
        cells,
      };
    });

    return {
      id: sheetId,
      name: parsedSheet.name || `Sheet ${index + 1}`,
      source: inferSourceFromSheetName(parsedSheet.name),
      columns,
      rows,
    };
  });

  return {
    scenarioId,
    draft: {
      sheets,
      sourceFileName: meta.fileName || null,
      importBatch: meta.batchId || null,
      updatedAt: new Date().toISOString(),
      updatedBy: meta.userId || 'system',
    },
    published: null,
    publishedMeta: null,
  };
}

function flattenWorkbookSheetsToForecastLines(sheets, scenarioId, meta = {}) {
  const now = meta.now || new Date().toISOString();
  const lines = [];

  for (const sheet of sheets || []) {
    for (const row of sheet.rows || []) {
      for (const column of sheet.columns || []) {
        const cell = row.cells?.[column.periodKey];
        if (!cell?.id) continue;

        const value = cell.value ?? null;
        lines.push({
          id: cell.id,
          scenarioId,
          sheetName: sheet.name,
          rowLabel: row.label || '',
          rowIndex: row.rowIndex ?? null,
          section: row.section || '',
          indent: row.indent || 0,
          isHeader: row.isHeader || false,
          isSummary: row.isSummary || false,
          source: sheet.source || inferSourceFromSheetName(sheet.name),
          periodType: column.periodType || inferPeriodType(column.periodKey),
          periodKey: column.periodKey,
          value,
          formula: cell.formula || null,
          numberFormat: cell.numberFormat || null,
          formattedText: cell.formattedText || null,
          displayType: cell.displayType || 'number',
          decimals: cell.decimals ?? 1,
          readOnly: cell.readOnly ?? Boolean(cell.formula),
          market: 'Total',
          businessModel: 'Total',
          metrics: value == null ? {} : { [sanitizeMetricKey(row.label)]: value },
          inputMode: meta.inputMode || 'manual',
          importBatch: meta.importBatch || null,
          updatedBy: meta.userId || 'system',
          updatedAt: now,
        });
      }
    }
  }

  return lines;
}

function workbookDiffSummary(draft, published) {
  if (!draft?.sheets?.length || !published?.sheets?.length) {
    return { changedCells: 0, changedRows: 0, hasPublished: Boolean(published?.sheets?.length) };
  }

  const publishedCells = new Map();
  for (const sheet of published.sheets) {
    for (const row of sheet.rows || []) {
      for (const [periodKey, cell] of Object.entries(row.cells || {})) {
        publishedCells.set(cell.id, { sheetName: sheet.name, rowId: row.id, periodKey, value: cell.value ?? null });
      }
    }
  }

  let changedCells = 0;
  const changedRows = new Set();
  for (const sheet of draft.sheets) {
    for (const row of sheet.rows || []) {
      for (const [periodKey, cell] of Object.entries(row.cells || {})) {
        const publishedCell = publishedCells.get(cell.id);
        if (!publishedCell || (publishedCell.value ?? null) !== (cell.value ?? null)) {
          changedCells += 1;
          changedRows.add(`${sheet.name}:${row.id}`);
        }
      }
    }
  }

  return { changedCells, changedRows: changedRows.size, hasPublished: true };
}

const strategyStore = {
  // Raw data for sync export
  getRawData() { return readData(); },
  setRawData(data) { writeData(data); },

  // ===== Scenarios =====

  getScenarios() {
    return readData().scenarios;
  },

  getScenarioById(id) {
    return readData().scenarios.find(s => s.id === id) || null;
  },

  ensureScenarioWorkbook(scenarioId, data = null) {
    const targetData = data || readData();
    let workbook = targetData.forecastWorkbooks.find(item => item.scenarioId === scenarioId);
    if (workbook) return workbook;

    const scenarioLines = targetData.forecastLines.filter(line => line.scenarioId === scenarioId);
    workbook = buildWorkbookFromLines(scenarioLines, scenarioId);
    targetData.forecastWorkbooks.push(workbook);
    if (!data) writeData(targetData);
    return workbook;
  },

  getScenarioWorkbook(scenarioId, version = 'draft') {
    const data = readData();
    const workbook = this.ensureScenarioWorkbook(scenarioId, data);
    const draft = cloneJson(workbook.draft || { sheets: [] });
    const published = cloneJson(workbook.published || null);

    return {
      scenarioId,
      version,
      draft,
      published,
      publishedMeta: cloneJson(workbook.publishedMeta || null),
      diffSummary: workbookDiffSummary(draft, published),
    };
  },

  createScenario({ name, type, currency, unit, startPeriod, endPeriod, markets, businessModels, createdBy }) {
    if (!name || !name.trim()) throw new Error('Scenario 名稱為必填');
    const data = readData();
    const now = new Date().toISOString();
    const scenario = {
      id: nextId(data.scenarios, 'scn'),
      name: name.trim(),
      type: type || 'base',
      status: 'draft',
      currency: currency || 'NTD',
      unit: unit || 'M',
      startPeriod: startPeriod || '2022',
      endPeriod: endPeriod || '2030',
      markets: markets || ['台灣', '北美', '新加坡'],
      businessModels: businessModels || ['卡車運輸', '跨境物流', '終端配送', '軟體服務', '倉儲'],
      createdAt: now,
      updatedAt: now,
      createdBy: createdBy || null,
    };
    data.scenarios.push(scenario);
    addAudit(data, { action: 'create', entity: 'scenario', entityId: scenario.id, detail: `Created scenario: ${name}`, userId: createdBy });
    writeData(data);
    return scenario;
  },

  updateScenario(id, fields, userId) {
    const data = readData();
    const scn = data.scenarios.find(s => s.id === id);
    if (!scn) throw new Error('Scenario not found');
    const changes = [];
    if (fields.name !== undefined) { changes.push(`name: ${scn.name} → ${fields.name}`); scn.name = fields.name.trim(); }
    if (fields.type !== undefined) { changes.push(`type: ${scn.type} → ${fields.type}`); scn.type = fields.type; }
    if (fields.status !== undefined) { changes.push(`status: ${scn.status} → ${fields.status}`); scn.status = fields.status; }
    if (fields.markets !== undefined) { scn.markets = fields.markets; changes.push('markets updated'); }
    if (fields.businessModels !== undefined) { scn.businessModels = fields.businessModels; changes.push('businessModels updated'); }
    scn.updatedAt = new Date().toISOString();
    if (changes.length > 0) {
      addAudit(data, { action: 'update', entity: 'scenario', entityId: id, detail: changes.join('; '), userId });
    }
    writeData(data);
    return scn;
  },

  cloneScenario(id, newName, newType, userId) {
    const data = readData();
    const source = data.scenarios.find(s => s.id === id);
    if (!source) throw new Error('Source scenario not found');
    const now = new Date().toISOString();
    const newScn = {
      ...JSON.parse(JSON.stringify(source)),
      id: nextId(data.scenarios, 'scn'),
      name: newName || `${source.name} (Copy)`,
      type: newType || 'custom',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      createdBy: userId || source.createdBy,
    };
    data.scenarios.push(newScn);
    // Clone all forecast lines
    const sourceLines = data.forecastLines.filter(fl => fl.scenarioId === id);
    let lineCounter = data.forecastLines.reduce((m, fl) => {
      const n = parseInt(fl.id.replace('fl_', ''), 10);
      return n > m ? n : m;
    }, 0);
    const clonedLines = sourceLines.map(fl => ({
      ...JSON.parse(JSON.stringify(fl)),
      id: `fl_${++lineCounter}`,
      scenarioId: newScn.id,
      inputMode: 'copied',
      updatedAt: now,
      updatedBy: userId,
    }));
    data.forecastLines.push(...clonedLines);
    data.forecastWorkbooks = data.forecastWorkbooks.filter(item => item.scenarioId !== newScn.id);
    data.forecastWorkbooks.push(buildWorkbookFromLines(clonedLines, newScn.id));
    addAudit(data, { action: 'clone', entity: 'scenario', entityId: newScn.id, detail: `Cloned from ${source.name} (${id}), ${clonedLines.length} lines`, userId });
    writeData(data);
    return newScn;
  },

  deleteScenario(id, userId) {
    const data = readData();
    const idx = data.scenarios.findIndex(s => s.id === id);
    if (idx === -1) throw new Error('Scenario not found');
    const scn = data.scenarios[idx];
    if (scn.status === 'published') throw new Error('Cannot delete published scenario');
    data.scenarios.splice(idx, 1);
    // Remove associated forecast lines
    const removedCount = data.forecastLines.filter(fl => fl.scenarioId === id).length;
    data.forecastLines = data.forecastLines.filter(fl => fl.scenarioId !== id);
    data.forecastWorkbooks = data.forecastWorkbooks.filter(item => item.scenarioId !== id);
    addAudit(data, { action: 'delete', entity: 'scenario', entityId: id, detail: `Deleted ${scn.name}, removed ${removedCount} forecast lines`, userId });
    writeData(data);
  },

  // ===== Forecast Lines =====

  getForecastLines(filters = {}) {
    const data = readData();
    let lines = data.forecastLines;

    if (filters.scenarioId) {
      const workbook = data.forecastWorkbooks.find(item => item.scenarioId === filters.scenarioId);
      const wantsDraft = filters.version === 'draft';
      const wantsPublished = filters.version === 'published';
      const prefersPublished = !filters.version || filters.version === 'published_preferred';

      if (workbook?.published?.sheets?.length && (wantsPublished || prefersPublished)) {
        lines = flattenWorkbookSheetsToForecastLines(workbook.published.sheets, filters.scenarioId, {
          inputMode: 'published',
          userId: workbook.publishedMeta?.publishedBy || 'system',
          now: workbook.publishedMeta?.publishedAt || new Date().toISOString(),
        });
      } else if (workbook?.draft?.sheets?.length && wantsDraft) {
        lines = flattenWorkbookSheetsToForecastLines(workbook.draft.sheets, filters.scenarioId, {
          inputMode: 'manual',
          userId: workbook.draft.updatedBy || 'system',
          now: workbook.draft.updatedAt || new Date().toISOString(),
        });
      }
    }

    if (filters.scenarioId) lines = lines.filter(fl => fl.scenarioId === filters.scenarioId);
    if (filters.market) lines = lines.filter(fl => fl.market === filters.market);
    if (filters.businessModel) lines = lines.filter(fl => fl.businessModel === filters.businessModel);
    if (filters.periodType) lines = lines.filter(fl => fl.periodType === filters.periodType);
    if (filters.year) lines = lines.filter(fl => fl.periodKey.startsWith(filters.year));
    if (filters.sheetName) lines = lines.filter(fl => fl.sheetName === filters.sheetName);
    return lines;
  },

  updateForecastLine(id, updates, userId) {
    const data = readData();
    const fl = data.forecastLines.find(l => l.id === id);
    if (!fl) throw new Error('Forecast line not found');
    const workbook = this.ensureScenarioWorkbook(fl.scenarioId, data);
    const workbookCell = findWorkbookCell(workbook.draft, fl.id);

    const oldValue = buildForecastLineAuditValue(fl);

    // Support both cell-level value and legacy metrics update
    if (updates.value !== undefined) {
      if (workbookCell?.cell?.formula) throw new Error('公式儲存格目前為唯讀，請保留 Excel 公式');
      fl.value = normalizeNumericValue(updates.value);
    }
    if (updates.metrics) {
      if (!fl.metrics) fl.metrics = {};
      Object.assign(fl.metrics, updates.metrics);
      if (updates.value === undefined) {
        fl.value = inferMetricValue(updates);
      }
    }
    if (updates.rowLabel !== undefined) fl.rowLabel = updates.rowLabel;
    if (updates.section !== undefined) fl.section = updates.section;
    if (updates.indent !== undefined) fl.indent = updates.indent;

    fl.inputMode = 'manual';
    fl.updatedBy = userId;
    fl.updatedAt = new Date().toISOString();

    if (workbookCell) {
      updateWorkbookCellValue(workbookCell.cell, fl.value ?? null);
      workbookCell.row.label = fl.rowLabel;
      workbookCell.row.section = fl.section || '';
      workbookCell.row.indent = fl.indent || 0;
      workbook.draft.updatedAt = fl.updatedAt;
      workbook.draft.updatedBy = userId;
    }
    markScenarioUpdated(data, fl.scenarioId, fl.updatedAt);

    const label = buildForecastLineLabel(fl);
    addAudit(data, {
      action: 'update',
      entity: 'forecastLine',
      entityId: id,
      detail: `${label}/${fl.periodKey}: ${fl.value !== undefined ? fl.value : JSON.stringify(updates.metrics || {})}`,
      userId,
      oldValue,
      newValue: buildForecastLineAuditValue(fl),
    });
    writeData(data);
    return fl;
  },

  // Revert a specific audit entry — restores the old values
  revertAudit(auditId, userId) {
    const data = readData();
    const audit = data.auditLog.find(a => a.id === auditId);
    if (!audit) throw new Error('Audit entry not found');
    if (!audit.oldValue) throw new Error('此紀錄無法還原（沒有舊值）');

    if (audit.entity === 'forecastLine' && audit.entityId) {
      const fl = data.forecastLines.find(l => l.id === audit.entityId);
      if (!fl) throw new Error('Forecast line not found (may have been deleted)');
      const workbook = this.ensureScenarioWorkbook(fl.scenarioId, data);
      const currentValue = buildForecastLineAuditValue(fl);
      if (audit.oldValue.value !== undefined) fl.value = audit.oldValue.value;
      if (audit.oldValue.metrics !== undefined) fl.metrics = cloneJson(audit.oldValue.metrics);
      if (audit.oldValue.rowLabel !== undefined) fl.rowLabel = audit.oldValue.rowLabel;
      if (audit.oldValue.section !== undefined) fl.section = audit.oldValue.section;
      if (audit.oldValue.indent !== undefined) fl.indent = audit.oldValue.indent;
      fl.inputMode = 'reverted';
      fl.updatedBy = userId;
      fl.updatedAt = new Date().toISOString();

      const workbookCell = findWorkbookCell(workbook.draft, fl.id);
      if (workbookCell) {
        updateWorkbookCellValue(workbookCell.cell, fl.value ?? null);
        workbookCell.row.label = fl.rowLabel;
        workbookCell.row.section = fl.section || '';
        workbookCell.row.indent = fl.indent || 0;
        workbook.draft.updatedAt = fl.updatedAt;
        workbook.draft.updatedBy = userId;
      }
      markScenarioUpdated(data, fl.scenarioId, fl.updatedAt);

      addAudit(data, {
        action: 'revert',
        entity: 'forecastLine',
        entityId: fl.id,
        detail: `Reverted ${buildForecastLineLabel(fl)}/${fl.periodKey} to values before ${audit.timestamp}`,
        userId,
        oldValue: currentValue,
        newValue: buildForecastLineAuditValue(fl),
      });
    } else {
      throw new Error('此類型紀錄不支援還原');
    }

    writeData(data);
    return { ok: true, auditId, entity: audit.entity, entityId: audit.entityId };
  },

  // Create a snapshot of a scenario (version freeze)
  createSnapshot(scenarioId, snapshotName, userId) {
    const data = readData();
    const scn = data.scenarios.find(s => s.id === scenarioId);
    if (!scn) throw new Error('Scenario not found');
    const workbook = this.ensureScenarioWorkbook(scenarioId, data);
    const lines = data.forecastLines.filter(fl => fl.scenarioId === scenarioId);
    const now = new Date().toISOString();
    // Store snapshot as a special audit entry with full data
    const snapshotId = `snap_${Date.now()}`;
    addAudit(data, {
      action: 'snapshot',
      entity: 'scenario',
      entityId: scenarioId,
      detail: snapshotName || `Snapshot at ${now}`,
      userId,
      oldValue: {
        scenario: JSON.parse(JSON.stringify(scn)),
        lineCount: lines.length,
        lines: JSON.parse(JSON.stringify(lines)),
        workbook: cloneJson(workbook),
      },
      newValue: { snapshotId },
    });
    writeData(data);
    return { snapshotId, name: snapshotName, lineCount: lines.length, timestamp: now };
  },

  // Restore a scenario from a snapshot
  restoreSnapshot(auditId, userId) {
    const data = readData();
    const audit = data.auditLog.find(a => a.id === auditId && a.action === 'snapshot');
    if (!audit || !audit.oldValue?.lines) throw new Error('Snapshot not found');
    const scenarioId = audit.entityId;
    const scn = data.scenarios.find(s => s.id === scenarioId);
    if (!scn) throw new Error('Scenario not found');
    const workbook = this.ensureScenarioWorkbook(scenarioId, data);

    // Record current state before restore
    const currentLines = data.forecastLines.filter(fl => fl.scenarioId === scenarioId);
    addAudit(data, {
      action: 'pre_restore_snapshot',
      entity: 'scenario',
      entityId: scenarioId,
      detail: `Auto-snapshot before restoring to "${audit.detail}"`,
      userId,
      oldValue: {
        scenario: JSON.parse(JSON.stringify(scn)),
        lineCount: currentLines.length,
        lines: JSON.parse(JSON.stringify(currentLines)),
        workbook: cloneJson(workbook),
      },
    });

    // Remove current lines and replace with snapshot
    data.forecastLines = data.forecastLines.filter(fl => fl.scenarioId !== scenarioId);
    data.forecastLines.push(...JSON.parse(JSON.stringify(audit.oldValue.lines)));
    data.forecastWorkbooks = data.forecastWorkbooks.filter(item => item.scenarioId !== scenarioId);
    if (audit.oldValue.workbook) {
      data.forecastWorkbooks.push(cloneJson(audit.oldValue.workbook));
    }

    addAudit(data, {
      action: 'restore_snapshot',
      entity: 'scenario',
      entityId: scenarioId,
      detail: `Restored to "${audit.detail}" (${audit.oldValue.lineCount} lines)`,
      userId,
    });
    writeData(data);
    return { ok: true, restoredLines: audit.oldValue.lineCount };
  },

  // Get snapshots for a scenario
  getSnapshots(scenarioId) {
    const data = readData();
    return data.auditLog
      .filter(a => a.action === 'snapshot' && a.entityId === scenarioId)
      .map(a => ({
        id: a.id,
        name: a.detail,
        timestamp: a.timestamp,
        userId: a.userId,
        lineCount: a.oldValue?.lineCount || 0,
      }))
      .reverse();
  },

  bulkUpdateForecastLines(updates, userId) {
    const data = readData();
    const now = new Date().toISOString();
    let count = 0;
    if (!Array.isArray(updates)) throw new Error('updates 必須為陣列');

    for (const update of updates) {
      if (update.id) {
        const fl = data.forecastLines.find(l => l.id === update.id);
        if (!fl) continue;
        const workbook = this.ensureScenarioWorkbook(fl.scenarioId, data);
        const workbookCell = findWorkbookCell(workbook.draft, fl.id);

        const oldValue = buildForecastLineAuditValue(fl);

        if (update.value !== undefined) {
          if (workbookCell?.cell?.formula) throw new Error(`公式儲存格不可直接修改: ${buildForecastLineLabel(fl)}/${fl.periodKey}`);
          fl.value = normalizeNumericValue(update.value);
        }

        if (update.metrics) {
          fl.metrics = { ...(fl.metrics || {}), ...update.metrics };
          if (update.value === undefined) {
            fl.value = inferMetricValue(update);
          }
        }

        if (update.rowLabel !== undefined) fl.rowLabel = update.rowLabel;
        if (update.section !== undefined) fl.section = update.section;
        if (update.indent !== undefined) fl.indent = update.indent;

        fl.inputMode = 'manual';
        fl.updatedBy = userId;
        fl.updatedAt = now;

        if (workbookCell) {
          updateWorkbookCellValue(workbookCell.cell, fl.value ?? null);
          workbookCell.row.label = fl.rowLabel;
          workbookCell.row.section = fl.section || '';
          workbookCell.row.indent = fl.indent || 0;
          workbook.draft.updatedAt = now;
          workbook.draft.updatedBy = userId;
        }
        markScenarioUpdated(data, fl.scenarioId, now);

        addAudit(data, {
          action: 'bulk_update',
          entity: 'forecastLine',
          entityId: fl.id,
          detail: `Bulk updated ${buildForecastLineLabel(fl)}/${fl.periodKey}`,
          userId,
          oldValue,
          newValue: buildForecastLineAuditValue(fl),
        });
        count++;
        continue;
      }

      if (!update.scenarioId || !update.periodKey) continue;

      const workbook = this.ensureScenarioWorkbook(update.scenarioId, data);
      const draftSheetName = update.sheetName || (workbook.draft.sheets[0]?.name || 'P&L Forecast');
      let sheet = workbook.draft.sheets.find(item => item.name === draftSheetName);
      if (!sheet) {
        sheet = {
          id: `sht_${workbook.draft.sheets.length + 1}`,
          name: draftSheetName,
          source: inferSourceFromSheetName(draftSheetName),
          columns: [],
          rows: [],
        };
        workbook.draft.sheets.push(sheet);
      }
      if (!sheet.columns.find(col => col.periodKey === update.periodKey)) {
        sheet.columns.push({
          id: `${sheet.id}_col_${sheet.columns.length + 1}`,
          header: update.periodKey,
          periodKey: update.periodKey,
          periodType: update.periodType || inferPeriodType(update.periodKey),
        });
        sheet.columns.sort(sortPeriodKeys);
      }

      const nextIdValue = nextForecastLineId(data);
      const value = inferMetricValue(update);
      const market = update.market || 'Total';
      const businessModel = update.businessModel || 'Total';
      const rowLabel = update.rowLabel
        || [market !== 'Total' ? market : '', businessModel !== 'Total' ? businessModel : ''].filter(Boolean).join(' / ')
        || '新 Forecast 行';

      const line = {
        id: nextIdValue,
        scenarioId: update.scenarioId,
        sheetName: sheet.name,
        rowLabel,
        rowIndex: null,
        section: update.section || '',
        indent: update.indent || 0,
        isHeader: false,
        isSummary: false,
        source: update.source || 'manual',
        periodType: update.periodType || inferPeriodType(update.periodKey),
        periodKey: update.periodKey,
        value,
        formula: null,
        numberFormat: update.numberFormat || null,
        formattedText: null,
        displayType: update.displayType || 'number',
        decimals: update.decimals ?? 1,
        readOnly: false,
        market,
        businessModel,
        metrics: update.metrics || { value },
        inputMode: 'manual',
        updatedBy: userId,
        updatedAt: now,
      };

      data.forecastLines.push(line);

      let row = (sheet.rows || []).find(item => item.label === rowLabel && item.section === (update.section || ''));
      if (!row) {
        row = {
          id: `${sheet.id}_row_${sheet.rows.length + 1}`,
          rowIndex: sheet.rows.length > 0 ? Math.max(...sheet.rows.map(item => item.rowIndex ?? 0)) + 1 : 1,
          label: rowLabel,
          section: update.section || '',
          indent: update.indent || 0,
          isHeader: false,
          isSummary: false,
          cells: {},
        };
        sheet.rows.push(row);
      }
      row.cells[update.periodKey] = normalizeWorkbookCellData({
        id: line.id,
        value,
        formula: null,
        numberFormat: update.numberFormat || null,
        displayType: update.displayType || 'number',
        decimals: update.decimals ?? 1,
        readOnly: false,
      });
      workbook.draft.updatedAt = now;
      workbook.draft.updatedBy = userId;
      markScenarioUpdated(data, update.scenarioId, now);

      addAudit(data, {
        action: 'create',
        entity: 'forecastLine',
        entityId: line.id,
        detail: `Created ${buildForecastLineLabel(line)}/${line.periodKey}`,
        userId,
        newValue: buildForecastLineAuditValue(line),
      });
      count++;
    }

    addAudit(data, {
      action: 'bulk_update',
      entity: 'forecastLine',
      entityId: null,
      detail: `Updated ${count} lines`,
      userId,
      newValue: { count },
    });
    writeData(data);
    return count;
  },

  importScenarioWorkbook(scenarioId, parsedSheets, { batchId, fileName, userId }) {
    const data = readData();
    const now = new Date().toISOString();
    const workbook = buildWorkbookDraftFromParsedSheets(data, scenarioId, parsedSheets, { batchId, fileName, userId });
    const draftLines = flattenWorkbookSheetsToForecastLines(workbook.draft.sheets, scenarioId, {
      inputMode: 'imported',
      importBatch: batchId,
      userId,
      now,
    });

    data.forecastLines = data.forecastLines.filter(fl => fl.scenarioId !== scenarioId);
    data.forecastLines.push(...draftLines);
    data.forecastWorkbooks = data.forecastWorkbooks.filter(item => item.scenarioId !== scenarioId);
    data.forecastWorkbooks.push(workbook);
    markScenarioUpdated(data, scenarioId, now);

    data.importHistory.push({
      id: batchId,
      scenarioId,
      fileName: fileName || 'unknown',
      lineCount: draftLines.length,
      importedAt: now,
      importedBy: userId,
    });

    addAudit(data, {
      action: 'import_workbook',
      entity: 'scenario',
      entityId: scenarioId,
      detail: `Imported workbook ${fileName || 'unknown'} (${draftLines.length} cells)`,
      userId,
      newValue: { batchId, lineCount: draftLines.length, sheetCount: workbook.draft.sheets.length },
    });

    writeData(data);
    return {
      lineCount: draftLines.length,
      sheetCount: workbook.draft.sheets.length,
      workbook: cloneJson(workbook),
    };
  },

  addWorkbookRow(scenarioId, {
    sheetName,
    rowLabel,
    section,
    defaultValue = 0,
    displayType = 'number',
    numberFormat = null,
    decimals = 1,
  }, userId) {
    const data = readData();
    const workbook = this.ensureScenarioWorkbook(scenarioId, data);
    const now = new Date().toISOString();
    const sheet = workbook.draft.sheets.find(item => item.name === sheetName) || workbook.draft.sheets[0];
    if (!sheet) throw new Error('Workbook sheet not found');

    const row = {
      id: `${sheet.id}_row_${sheet.rows.length + 1}`,
      rowIndex: sheet.rows.length > 0 ? Math.max(...sheet.rows.map(item => item.rowIndex ?? 0)) + 1 : 1,
      label: rowLabel,
      section: section || '',
      indent: 0,
      isHeader: false,
      isSummary: false,
      cells: {},
    };

    for (const column of sheet.columns || []) {
      const lineId = nextForecastLineId(data);
      row.cells[column.periodKey] = normalizeWorkbookCellData({
        id: lineId,
        value: defaultValue,
        formula: null,
        numberFormat,
        formattedText: null,
        displayType,
        decimals,
        readOnly: false,
      });
      data.forecastLines.push({
        id: lineId,
        scenarioId,
        sheetName: sheet.name,
        rowLabel,
        rowIndex: row.rowIndex,
        section: row.section,
        indent: 0,
        isHeader: false,
        isSummary: false,
        source: sheet.source || inferSourceFromSheetName(sheet.name),
        periodType: column.periodType || inferPeriodType(column.periodKey),
        periodKey: column.periodKey,
        value: defaultValue,
        formula: null,
        numberFormat,
        formattedText: null,
        displayType,
        decimals,
        readOnly: false,
        market: 'Total',
        businessModel: 'Total',
        metrics: { [sanitizeMetricKey(rowLabel)]: defaultValue },
        inputMode: 'manual',
        updatedBy: userId,
        updatedAt: now,
      });
    }

    sheet.rows.push(row);
    workbook.draft.updatedAt = now;
    workbook.draft.updatedBy = userId;
    markScenarioUpdated(data, scenarioId, now);

    addAudit(data, {
      action: 'add_workbook_row',
      entity: 'scenario',
      entityId: scenarioId,
      detail: `Added workbook row ${rowLabel} to ${sheet.name}`,
      userId,
      newValue: { rowLabel, sheetName: sheet.name, cells: Object.keys(row.cells).length },
    });

    writeData(data);
    return cloneJson(row);
  },

  publishScenarioWorkbook(scenarioId, userId, note) {
    const data = readData();
    const workbook = this.ensureScenarioWorkbook(scenarioId, data);
    const scenario = data.scenarios.find(item => item.id === scenarioId);
    if (!scenario) throw new Error('Scenario not found');

    const now = new Date().toISOString();
    const nextVersionNo = (workbook.publishedMeta?.versionNo || 0) + 1;
    workbook.published = cloneJson(workbook.draft);
    workbook.publishedMeta = {
      versionNo: nextVersionNo,
      publishedAt: now,
      publishedBy: userId || 'system',
      note: note || '',
    };
    scenario.status = 'published';
    scenario.updatedAt = now;

    addAudit(data, {
      action: 'publish',
      entity: 'scenario',
      entityId: scenarioId,
      detail: `Published forecast workbook v${nextVersionNo}${note ? ` — ${note}` : ''}`,
      userId,
      newValue: cloneJson(workbook.publishedMeta),
    });

    writeData(data);
    return cloneJson(workbook.publishedMeta);
  },

  bulkImportForecastLines(scenarioId, lines, batchId, userId) {
    const data = readData();
    const now = new Date().toISOString();
    let counter = data.forecastLines.reduce((m, fl) => {
      const n = parseInt(fl.id.replace('fl_', ''), 10);
      return n > m ? n : m;
    }, 0);

    const newLines = lines.map(line => ({
      id: `fl_${++counter}`,
      scenarioId,
      // Original Excel row metadata (cell-level)
      rowLabel: line.rowLabel || '',
      rowIndex: line.rowIndex ?? null,
      section: line.section || '',
      indent: line.indent || 0,
      isHeader: line.isHeader || false,
      isSummary: line.isSummary || false,
      source: line.source || '',
      // Period
      periodType: line.periodType || 'quarter',
      periodKey: line.periodKey,
      // Cell value (single number for this row × column)
      value: line.value ?? null,
      // Legacy fields
      market: line.market || 'Total',
      businessModel: line.businessModel || 'Total',
      metrics: line.metrics || {},
      inputMode: 'imported',
      importBatch: batchId,
      updatedBy: userId,
      updatedAt: now,
    }));

    data.forecastLines.push(...newLines);

    // Record import history
    data.importHistory.push({
      id: batchId,
      scenarioId,
      fileName: lines._fileName || 'unknown',
      lineCount: newLines.length,
      importedAt: now,
      importedBy: userId,
    });

    addAudit(data, { action: 'import', entity: 'forecastLine', entityId: scenarioId, detail: `Imported ${newLines.length} lines (batch: ${batchId})`, userId });
    writeData(data);
    return newLines.length;
  },

  clearScenarioLines(scenarioId, userId) {
    const data = readData();
    const count = data.forecastLines.filter(fl => fl.scenarioId === scenarioId).length;
    data.forecastLines = data.forecastLines.filter(fl => fl.scenarioId !== scenarioId);
    const workbook = data.forecastWorkbooks.find(item => item.scenarioId === scenarioId);
    if (workbook) {
      workbook.draft = { sheets: [], updatedAt: new Date().toISOString(), updatedBy: userId || 'system' };
    }
    markScenarioUpdated(data, scenarioId, new Date().toISOString());
    addAudit(data, { action: 'clear', entity: 'forecastLine', entityId: scenarioId, detail: `Cleared ${count} lines`, userId });
    writeData(data);
    return count;
  },

  getImportHistory(scenarioId) {
    const data = readData();
    let history = data.importHistory;
    if (scenarioId) history = history.filter(h => h.scenarioId === scenarioId);
    return history.sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
  },

  // ===== KPI Definitions =====

  getKpiDefinitions() {
    return readData().kpiDefinitions.filter(k => k.isActive);
  },

  getAllKpiDefinitions() {
    return readData().kpiDefinitions;
  },

  createKpiDefinition(def, userId) {
    const data = readData();
    const kpi = {
      id: nextId(data.kpiDefinitions, 'kpi'),
      code: def.code,
      name: def.name,
      nameEn: def.nameEn || def.name,
      formulaType: def.formulaType || 'ratio',
      numerator: def.numerator,
      denominator: def.denominator,
      displayUnit: def.displayUnit || '%',
      thresholdGreen: def.thresholdGreen ?? 0.9,
      thresholdYellow: def.thresholdYellow ?? 0.7,
      thresholdRed: def.thresholdRed ?? 0,
      isActive: true,
    };
    data.kpiDefinitions.push(kpi);
    addAudit(data, { action: 'create', entity: 'kpiDefinition', entityId: kpi.id, detail: `Created KPI: ${kpi.name}`, userId });
    writeData(data);
    return kpi;
  },

  updateKpiDefinition(id, fields, userId) {
    const data = readData();
    const kpi = data.kpiDefinitions.find(k => k.id === id);
    if (!kpi) throw new Error('KPI definition not found');
    const allowed = ['name', 'nameEn', 'thresholdGreen', 'thresholdYellow', 'thresholdRed', 'isActive', 'formulaType', 'numerator', 'denominator', 'displayUnit'];
    for (const key of allowed) {
      if (fields[key] !== undefined) kpi[key] = fields[key];
    }
    addAudit(data, { action: 'update', entity: 'kpiDefinition', entityId: id, detail: `Updated KPI: ${kpi.name}`, userId });
    writeData(data);
    return kpi;
  },

  // ===== Strategies =====

  getStrategies(filters = {}) {
    let strategies = readData().strategies;
    if (filters.status) strategies = strategies.filter(s => s.status === filters.status);
    if (filters.owner) strategies = strategies.filter(s => s.owner === filters.owner);
    if (filters.targetMarket) strategies = strategies.filter(s => s.targetMarket === filters.targetMarket);
    return strategies;
  },

  getStrategyById(id) {
    return readData().strategies.find(s => s.id === id) || null;
  },

  createStrategy({ title, description, status, priority, owner, linkedLeadIds, targetMarket, targetBusinessModel, createdBy }) {
    if (!title || !title.trim()) throw new Error('策略標題為必填');
    const data = readData();
    const now = new Date().toISOString();
    const strategy = {
      id: nextId(data.strategies, 'str'),
      title: title.trim(),
      description: (description || '').trim(),
      status: status || 'planned',
      priority: priority || 'medium',
      owner: (owner || '').trim(),
      linkedLeadIds: linkedLeadIds || [],
      targetMarket: targetMarket || '',
      targetBusinessModel: targetBusinessModel || '',
      milestones: [],
      createdAt: now,
      updatedAt: now,
      createdBy: createdBy || null,
    };
    data.strategies.push(strategy);
    addAudit(data, { action: 'create', entity: 'strategy', entityId: strategy.id, detail: `Created strategy: ${title}`, userId: createdBy });
    writeData(data);
    return strategy;
  },

  updateStrategy(id, fields, userId) {
    const data = readData();
    const str = data.strategies.find(s => s.id === id);
    if (!str) throw new Error('Strategy not found');
    const allowed = ['title', 'description', 'status', 'priority', 'owner', 'linkedLeadIds', 'targetMarket', 'targetBusinessModel'];
    for (const key of allowed) {
      if (fields[key] !== undefined) str[key] = fields[key];
    }
    str.updatedAt = new Date().toISOString();
    addAudit(data, { action: 'update', entity: 'strategy', entityId: id, detail: `Updated strategy: ${str.title}`, userId });
    writeData(data);
    return str;
  },

  deleteStrategy(id, userId) {
    const data = readData();
    const idx = data.strategies.findIndex(s => s.id === id);
    if (idx === -1) throw new Error('Strategy not found');
    const name = data.strategies[idx].title;
    data.strategies.splice(idx, 1);
    addAudit(data, { action: 'delete', entity: 'strategy', entityId: id, detail: `Deleted strategy: ${name}`, userId });
    writeData(data);
  },

  addMilestone(strategyId, { title, dueDate }, userId) {
    const data = readData();
    const str = data.strategies.find(s => s.id === strategyId);
    if (!str) throw new Error('Strategy not found');
    if (!title || !title.trim()) throw new Error('里程碑標題為必填');
    const ms = {
      id: `ms_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      title: title.trim(),
      dueDate: dueDate || null,
      completed: false,
      completedAt: null,
    };
    str.milestones.push(ms);
    str.updatedAt = new Date().toISOString();
    addAudit(data, { action: 'add_milestone', entity: 'strategy', entityId: strategyId, detail: `Added milestone: ${title}`, userId });
    writeData(data);
    return ms;
  },

  updateMilestone(strategyId, milestoneId, fields, userId) {
    const data = readData();
    const str = data.strategies.find(s => s.id === strategyId);
    if (!str) throw new Error('Strategy not found');
    const ms = str.milestones.find(m => m.id === milestoneId);
    if (!ms) throw new Error('Milestone not found');
    if (fields.title !== undefined) ms.title = fields.title.trim();
    if (fields.dueDate !== undefined) ms.dueDate = fields.dueDate;
    if (fields.completed !== undefined) {
      ms.completed = fields.completed;
      ms.completedAt = fields.completed ? new Date().toISOString() : null;
    }
    str.updatedAt = new Date().toISOString();
    addAudit(data, { action: 'update_milestone', entity: 'strategy', entityId: strategyId, detail: `${ms.completed ? 'Completed' : 'Updated'} milestone: ${ms.title}`, userId });
    writeData(data);
    return ms;
  },

  deleteMilestone(strategyId, milestoneId, userId) {
    const data = readData();
    const str = data.strategies.find(s => s.id === strategyId);
    if (!str) throw new Error('Strategy not found');
    const idx = str.milestones.findIndex(m => m.id === milestoneId);
    if (idx === -1) throw new Error('Milestone not found');
    const name = str.milestones[idx].title;
    str.milestones.splice(idx, 1);
    str.updatedAt = new Date().toISOString();
    addAudit(data, { action: 'delete_milestone', entity: 'strategy', entityId: strategyId, detail: `Deleted milestone: ${name}`, userId });
    writeData(data);
  },

  // ===== Audit Log =====

  getAuditLog(limit = 50, filters = {}) {
    const data = readData();
    let auditLog = data.auditLog;

    if (filters.scenarioId) {
      const scenarioId = filters.scenarioId;
      const scenarioLineIds = new Set(
        data.forecastLines
          .filter(line => line.scenarioId === scenarioId)
          .map(line => line.id)
      );

      auditLog = auditLog.filter(audit => {
        if (audit.entity === 'scenario') return audit.entityId === scenarioId;
        if (audit.entity !== 'forecastLine') return false;
        if (audit.entityId?.startsWith('scn_')) return audit.entityId === scenarioId;
        if (scenarioLineIds.has(audit.entityId)) return true;

        const snapshotLines = audit.oldValue?.lines;
        return Array.isArray(snapshotLines) && snapshotLines.some(lineItem => lineItem.scenarioId === scenarioId);
      });
    }

    return auditLog.slice(-limit).reverse();
  },
};

module.exports = strategyStore;
