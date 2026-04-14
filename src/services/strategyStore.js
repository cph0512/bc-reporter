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
  kpiDefinitions: [],
  strategies: [],
  importHistory: [],
  auditLog: [],
};

function readData() {
  try {
    if (!fs.existsSync(STRATEGY_FILE)) return { ...DEFAULT_DATA };
    const raw = JSON.parse(fs.readFileSync(STRATEGY_FILE, 'utf8'));
    return {
      scenarios: raw.scenarios || [],
      forecastLines: raw.forecastLines || [],
      kpiDefinitions: raw.kpiDefinitions || [],
      strategies: raw.strategies || [],
      importHistory: raw.importHistory || [],
      auditLog: raw.auditLog || [],
    };
  } catch {
    return { ...DEFAULT_DATA };
  }
}

function writeData(data) {
  const dir = path.dirname(STRATEGY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STRATEGY_FILE, JSON.stringify(data, null, 2), 'utf8');
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
    metrics: cloneJson(line.metrics || {}),
    rowLabel: line.rowLabel || '',
    section: line.section || '',
    indent: line.indent || 0,
  };
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

function matchesScenarioAudit(data, audit, scenarioId) {
  if (!scenarioId) return true;
  if (audit.entity === 'scenario') return audit.entityId === scenarioId;
  if (audit.entity !== 'forecastLine') return false;

  if (audit.entityId?.startsWith('scn_')) return audit.entityId === scenarioId;

  const line = data.forecastLines.find(fl => fl.id === audit.entityId);
  if (line) return line.scenarioId === scenarioId;

  const snapshotLines = audit.oldValue?.lines;
  if (Array.isArray(snapshotLines) && snapshotLines.length > 0) {
    return snapshotLines.some(lineItem => lineItem.scenarioId === scenarioId);
  }

  return false;
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
    addAudit(data, { action: 'delete', entity: 'scenario', entityId: id, detail: `Deleted ${scn.name}, removed ${removedCount} forecast lines`, userId });
    writeData(data);
  },

  // ===== Forecast Lines =====

  getForecastLines(filters = {}) {
    let lines = readData().forecastLines;
    if (filters.scenarioId) lines = lines.filter(fl => fl.scenarioId === filters.scenarioId);
    if (filters.market) lines = lines.filter(fl => fl.market === filters.market);
    if (filters.businessModel) lines = lines.filter(fl => fl.businessModel === filters.businessModel);
    if (filters.periodType) lines = lines.filter(fl => fl.periodType === filters.periodType);
    if (filters.year) lines = lines.filter(fl => fl.periodKey.startsWith(filters.year));
    return lines;
  },

  updateForecastLine(id, updates, userId) {
    const data = readData();
    const fl = data.forecastLines.find(l => l.id === id);
    if (!fl) throw new Error('Forecast line not found');

    const oldValue = buildForecastLineAuditValue(fl);

    // Support both cell-level value and legacy metrics update
    if (updates.value !== undefined) {
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
      const currentValue = buildForecastLineAuditValue(fl);
      if (audit.oldValue.value !== undefined) fl.value = audit.oldValue.value;
      if (audit.oldValue.metrics !== undefined) fl.metrics = cloneJson(audit.oldValue.metrics);
      if (audit.oldValue.rowLabel !== undefined) fl.rowLabel = audit.oldValue.rowLabel;
      if (audit.oldValue.section !== undefined) fl.section = audit.oldValue.section;
      if (audit.oldValue.indent !== undefined) fl.indent = audit.oldValue.indent;
      fl.inputMode = 'reverted';
      fl.updatedBy = userId;
      fl.updatedAt = new Date().toISOString();
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
      },
    });

    // Remove current lines and replace with snapshot
    data.forecastLines = data.forecastLines.filter(fl => fl.scenarioId !== scenarioId);
    data.forecastLines.push(...JSON.parse(JSON.stringify(audit.oldValue.lines)));

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

        const oldValue = buildForecastLineAuditValue(fl);

        if (update.value !== undefined) {
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
        market,
        businessModel,
        metrics: update.metrics || { value },
        inputMode: 'manual',
        updatedBy: userId,
        updatedAt: now,
      };

      data.forecastLines.push(line);
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
    return data.auditLog
      .filter(audit => matchesScenarioAudit(data, audit, filters.scenarioId))
      .slice(-limit)
      .reverse();
  },
};

module.exports = strategyStore;
