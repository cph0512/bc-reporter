// src/routes/reports.js
// REST API 路由 — 供 React Dashboard 和 LINE Bot 使用

const express = require('express');
const router = express.Router();

module.exports = function(reportEngine) {
  
  // ===== EBITDA =====

  /**
   * GET /api/ebitda?year=2025&month=6&compare=yoy
   * compare: yoy | mom | qoq | none
   */
  router.get('/ebitda', async (req, res) => {
    try {
      const { year, month, compare = 'none' } = req.query;
      if (!year || !month) return res.status(400).json({ error: 'year and month required' });

      if (compare === 'none') {
        const data = await reportEngine.getEbitda(Number(year), Number(month));
        return res.json({ data, period: { year: Number(year), month: Number(month) } });
      }

      const data = await reportEngine.getEbitdaComparison(Number(year), Number(month), compare);
      res.json(data);
    } catch (error) {
      console.error('[API] EBITDA error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ebitda/ytd?year=2025&month=6
   */
  router.get('/ebitda/ytd', async (req, res) => {
    try {
      const { year, month } = req.query;
      if (!year || !month) return res.status(400).json({ error: 'year and month required' });

      const data = await reportEngine.getEbitdaYTD(Number(year), Number(month));
      res.json({ data, period: { year: Number(year), upToMonth: Number(month) } });
    } catch (error) {
      console.error('[API] EBITDA YTD error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ebitda/trend?year=2025&months=6
   * Returns EBITDA for last N months
   */
  router.get('/ebitda/trend', async (req, res) => {
    try {
      const { year, month, months = 6 } = req.query;
      if (!year || !month) return res.status(400).json({ error: 'year and month required' });

      const trend = [];
      let y = Number(year);
      let m = Number(month);

      for (let i = 0; i < Number(months); i++) {
        try {
          const data = await reportEngine.getEbitda(y, m);
          trend.unshift({ year: y, month: m, ...data });
        } catch {
          trend.unshift({ year: y, month: m, ebitda: null });
        }
        m--;
        if (m < 1) { m = 12; y--; }
      }

      res.json({ trend });
    } catch (error) {
      console.error('[API] EBITDA trend error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Income Statement =====

  /**
   * GET /api/income-statement?year=2025&month=6&compare=yoy
   */
  router.get('/income-statement', async (req, res) => {
    try {
      const { year, month, compare = 'none' } = req.query;
      if (!year || !month) return res.status(400).json({ error: 'year and month required' });

      if (compare === 'none') {
        const data = await reportEngine.getIncomeStatement(Number(year), Number(month));
        return res.json({ data, period: { year: Number(year), month: Number(month) } });
      }

      const data = await reportEngine.getIncomeStatementComparison(Number(year), Number(month), compare);
      res.json(data);
    } catch (error) {
      console.error('[API] Income Statement error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Balance Sheet =====

  /**
   * GET /api/balance-sheet?year=2025&month=6&compare=yoy
   */
  router.get('/balance-sheet', async (req, res) => {
    try {
      const { year, month, compare = 'none' } = req.query;
      if (!year || !month) return res.status(400).json({ error: 'year and month required' });

      if (compare === 'none') {
        const data = await reportEngine.getBalanceSheet(Number(year), Number(month));
        return res.json({ data, period: { year: Number(year), month: Number(month) } });
      }

      const data = await reportEngine.getBalanceSheetComparison(Number(year), Number(month), compare);
      res.json(data);
    } catch (error) {
      console.error('[API] Balance Sheet error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Accounts (Chart of Accounts) =====

  /**
   * GET /api/accounts
   */
  router.get('/accounts', async (req, res) => {
    try {
      const data = await reportEngine.bc.getAccounts();
      res.json({ data });
    } catch (error) {
      console.error('[API] Accounts error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ===== Config =====

  /**
   * GET /api/config/accounts-mapping
   * Returns current accounts mapping for EBITDA calculation
   */
  router.get('/config/accounts-mapping', (req, res) => {
    const mapping = require('../../config/accounts-mapping.json');
    res.json(mapping);
  });

  /**
   * PUT /api/config/accounts-mapping
   * Update accounts mapping (saves to file)
   */
  router.put('/config/accounts-mapping', async (req, res) => {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const newMapping = req.body;

      // Validate required keys
      const requiredKeys = ['revenue', 'cogs', 'operating_expenses', 'depreciation', 'amortization', 'interest_expense', 'tax_expense'];
      for (const key of requiredKeys) {
        if (!Array.isArray(newMapping[key])) {
          return res.status(400).json({ error: `Missing or invalid key: ${key}` });
        }
      }

      const configPath = path.join(__dirname, '../../config/accounts-mapping.json');
      await fs.writeFile(configPath, JSON.stringify(newMapping, null, 2));

      // Clear cache since mapping changed
      reportEngine.cache.clear();

      res.json({ message: 'Accounts mapping updated', data: newMapping });
    } catch (error) {
      console.error('[API] Config update error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
