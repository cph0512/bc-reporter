// src/routes/strategy.js
// Strategy War Room routes — scenarios, forecast, KPIs, strategies, pipeline coverage

const express = require('express');
const multer = require('multer');
const router = express.Router();
const strategyStore = require('../services/strategyStore');
const strategyKpiService = require('../services/strategyKpiService');
const { parseForcastExcel, extractScenarioMeta } = require('../services/forecastImporter');
const { requireAdmin } = require('../middleware/auth');

// Multer config for Excel upload (memory storage, parse from buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.toLowerCase();
    cb(null, ext.endsWith('.xlsx') || ext.endsWith('.xls') || ext.endsWith('.csv'));
  },
});

// ===== Scenarios =====

router.get('/scenarios', (req, res) => {
  try {
    res.json(strategyStore.getScenarios());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/scenarios/:id', (req, res) => {
  try {
    const scn = strategyStore.getScenarioById(req.params.id);
    if (!scn) return res.status(404).json({ error: 'Scenario not found' });
    res.json(scn);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/scenarios', requireAdmin, (req, res) => {
  try {
    const scn = strategyStore.createScenario({
      ...req.body,
      createdBy: req.session.user?.username,
    });
    res.status(201).json(scn);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/scenarios/:id', requireAdmin, (req, res) => {
  try {
    const scn = strategyStore.updateScenario(req.params.id, req.body, req.session.user?.username);
    res.json(scn);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/scenarios/:id/clone', requireAdmin, (req, res) => {
  try {
    const { name, type } = req.body;
    const scn = strategyStore.cloneScenario(req.params.id, name, type, req.session.user?.username);
    res.status(201).json(scn);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/scenarios/:id', requireAdmin, (req, res) => {
  try {
    strategyStore.deleteScenario(req.params.id, req.session.user?.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== Forecast Import =====

router.post('/import', requireAdmin, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { scenarioId, scenarioName, clearExisting } = req.body;
    const userId = req.session.user?.username;
    const batchId = `batch_${Date.now()}`;

    // Parse Excel
    const result = parseForcastExcel(req.file.buffer, req.file.originalname);

    let targetScenarioId = scenarioId;

    // If no scenarioId, create new scenario from Excel metadata
    if (!targetScenarioId) {
      const meta = extractScenarioMeta(req.file.buffer);
      const scn = strategyStore.createScenario({
        name: scenarioName || req.file.originalname.replace(/\.(xlsx|xls|csv)$/i, ''),
        type: 'base',
        currency: 'NTD',
        unit: 'M',
        startPeriod: meta?.startPeriod || '2022',
        endPeriod: meta?.endPeriod || '2030',
        markets: meta?.markets || ['台灣', '北美', '新加坡'],
        businessModels: meta?.businessModels || ['卡車運輸', '跨境物流', '終端配送', '軟體服務', '倉儲'],
        createdBy: userId,
      });
      targetScenarioId = scn.id;
    }

    // Optionally clear existing lines
    if (clearExisting === 'true' || clearExisting === true) {
      strategyStore.clearScenarioLines(targetScenarioId, userId);
    }

    // Import lines
    result.allLines._fileName = req.file.originalname;
    const count = strategyStore.bulkImportForecastLines(targetScenarioId, result.allLines, batchId, userId);

    res.json({
      ok: true,
      scenarioId: targetScenarioId,
      imported: count,
      summary: result.summary,
      batchId,
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/import/history', (req, res) => {
  try {
    const history = strategyStore.getImportHistory(req.query.scenarioId);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Forecast Lines =====

router.get('/forecast', (req, res) => {
  try {
    const lines = strategyStore.getForecastLines({
      scenarioId: req.query.scenarioId,
      market: req.query.market,
      businessModel: req.query.biz,
      periodType: req.query.periodType,
      year: req.query.year,
    });
    res.json(lines);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/forecast/:id', requireAdmin, (req, res) => {
  try {
    const line = strategyStore.updateForecastLine(req.params.id, req.body.metrics, req.session.user?.username);
    res.json(line);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/forecast/bulk', requireAdmin, (req, res) => {
  try {
    const count = strategyStore.bulkUpdateForecastLines(req.body.updates, req.session.user?.username);
    res.json({ ok: true, updated: count });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== KPI Definitions =====

router.get('/kpi/definitions', (req, res) => {
  try {
    const all = req.query.all === 'true';
    res.json(all ? strategyStore.getAllKpiDefinitions() : strategyStore.getKpiDefinitions());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/kpi/definitions', requireAdmin, (req, res) => {
  try {
    const kpi = strategyStore.createKpiDefinition(req.body, req.session.user?.username);
    res.status(201).json(kpi);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/kpi/definitions/:id', requireAdmin, (req, res) => {
  try {
    const kpi = strategyStore.updateKpiDefinition(req.params.id, req.body, req.session.user?.username);
    res.json(kpi);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== KPI Calculation =====

router.get('/kpi/calculate', async (req, res) => {
  try {
    const result = await strategyKpiService.calculateKpis({
      scenarioId: req.query.scenarioId,
      companyId: req.query.companyId,
      year: parseInt(req.query.year) || new Date().getFullYear(),
      quarter: req.query.quarter ? parseInt(req.query.quarter) : null,
      reportEngine: req.app.locals.reportEngine,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/kpi/overview', async (req, res) => {
  try {
    const result = await strategyKpiService.getOverview({
      scenarioId: req.query.scenarioId,
      companyId: req.query.companyId,
      year: parseInt(req.query.year) || new Date().getFullYear(),
      reportEngine: req.app.locals.reportEngine,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Pipeline Coverage =====

router.get('/coverage', (req, res) => {
  try {
    const result = strategyKpiService.getPipelineCoverage({
      scenarioId: req.query.scenarioId,
      year: parseInt(req.query.year) || new Date().getFullYear(),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Strategies =====

router.get('/strategies', (req, res) => {
  try {
    const strategies = strategyStore.getStrategies({
      status: req.query.status,
      owner: req.query.owner,
      targetMarket: req.query.market,
    });
    res.json(strategies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/strategies/:id', (req, res) => {
  try {
    const str = strategyStore.getStrategyById(req.params.id);
    if (!str) return res.status(404).json({ error: 'Strategy not found' });
    res.json(str);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/strategies', (req, res) => {
  try {
    const str = strategyStore.createStrategy({
      ...req.body,
      createdBy: req.session.user?.username,
    });
    res.status(201).json(str);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/strategies/:id', (req, res) => {
  try {
    const str = strategyStore.updateStrategy(req.params.id, req.body, req.session.user?.username);
    res.json(str);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/strategies/:id', requireAdmin, (req, res) => {
  try {
    strategyStore.deleteStrategy(req.params.id, req.session.user?.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Milestones
router.post('/strategies/:id/milestones', (req, res) => {
  try {
    const ms = strategyStore.addMilestone(req.params.id, req.body, req.session.user?.username);
    res.status(201).json(ms);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/strategies/:id/milestones/:msId', (req, res) => {
  try {
    const ms = strategyStore.updateMilestone(req.params.id, req.params.msId, req.body, req.session.user?.username);
    res.json(ms);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/strategies/:id/milestones/:msId', (req, res) => {
  try {
    strategyStore.deleteMilestone(req.params.id, req.params.msId, req.session.user?.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== Audit Log & Revert =====

router.get('/audit', requireAdmin, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    res.json(strategyStore.getAuditLog(limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/audit/:id/revert', requireAdmin, (req, res) => {
  try {
    const result = strategyStore.revertAudit(req.params.id, req.session.user?.username);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== Snapshots =====

router.get('/snapshots', (req, res) => {
  try {
    res.json(strategyStore.getSnapshots(req.query.scenarioId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/snapshots', requireAdmin, (req, res) => {
  try {
    const result = strategyStore.createSnapshot(req.body.scenarioId, req.body.name, req.session.user?.username);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/snapshots/:id/restore', requireAdmin, (req, res) => {
  try {
    const result = strategyStore.restoreSnapshot(req.params.id, req.session.user?.username);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
