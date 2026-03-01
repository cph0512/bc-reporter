// src/index.js
// BC Financial Reporter — Main Entry Point

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const BCClient = require('./services/bcClient');
const ReportEngine = require('./services/reportEngine');
const LineBotService = require('./services/lineBot');
const createReportRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Middleware =====
app.use(cors());
app.use(express.json());

// ===== Initialize Services =====
const bcClient = new BCClient({
  BC_TENANT_ID: process.env.BC_TENANT_ID,
  BC_CLIENT_ID: process.env.BC_CLIENT_ID,
  BC_CLIENT_SECRET: process.env.BC_CLIENT_SECRET,
  BC_ENVIRONMENT: process.env.BC_ENVIRONMENT || 'Production',
  BC_COMPANY_ID: process.env.BC_COMPANY_ID,
});

const reportEngine = new ReportEngine(bcClient);

// ===== API Routes =====
app.use('/api', createReportRoutes(reportEngine));

// ===== LINE Bot Webhook =====
if (process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
  const lineBot = new LineBotService(process.env, reportEngine);

  app.post('/webhook/line', lineBot.middleware, async (req, res) => {
    try {
      await lineBot.handleWebhook(req.body.events);
      res.status(200).json({ status: 'ok' });
    } catch (error) {
      console.error('[LINE Webhook] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  console.log('✅ LINE Bot webhook enabled at /webhook/line');
}

// ===== Health Check =====
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║  📊 BC Financial Reporter                   ║
║  Server running on port ${PORT}                ║
║                                              ║
║  API:   http://localhost:${PORT}/api           ║
║  LINE:  http://localhost:${PORT}/webhook/line  ║
╚══════════════════════════════════════════════╝
  `);
});
