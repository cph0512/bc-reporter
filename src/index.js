// src/index.js
// BC Financial Reporter — Main Entry Point

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const BCClient = require('./services/bcClient');
const ReportEngine = require('./services/reportEngine');
const LineBotService = require('./services/lineBot');
const userStore = require('./services/userStore');
const createReportRoutes = require('./routes/reports');
const docsRoutes = require('./routes/docs');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const pipelineRoutes = require('./routes/pipeline');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const companyAccess = require('./middleware/companyAccess');
const companyStore = require('./services/companyStore');
const pipelineStore = require('./services/pipelineStore');
const contactStore = require('./services/contactStore');
const contactRoutes = require('./routes/contacts');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Middleware =====
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'bc-reporter-default-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// ===== Initialize Services =====
const bcClient = new BCClient({
  BC_TENANT_ID: process.env.BC_TENANT_ID,
  BC_CLIENT_ID: process.env.BC_CLIENT_ID,
  BC_CLIENT_SECRET: process.env.BC_CLIENT_SECRET,
  BC_ENVIRONMENT: process.env.BC_ENVIRONMENT || 'Production',
  BC_COMPANY_ID: process.env.BC_COMPANY_ID,
});

const reportEngine = new ReportEngine(bcClient);

// ===== Public Routes (no auth) =====

// Login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Auth API (login/logout/me)
app.use('/auth', authRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// LINE Bot Webhook (signature-validated by LINE SDK)
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

  console.log('LINE Bot webhook enabled at /webhook/line');
}

// ===== Sync Export (token-based, no session needed) =====
const syncSecret = process.env.SYNC_SECRET || 'bc-sync-default-key';
app.get('/api/sync/export', (req, res) => {
  if (req.headers['x-sync-secret'] !== syncSecret) {
    return res.status(401).json({ error: 'Invalid sync secret' });
  }
  res.json({
    users: userStore.getAllRaw(),
    pipeline: pipelineStore.getRawData(),
    contacts: contactStore.getRawData(),
  });
});

// ===== External Report API (sync-secret auth, for tg-service) =====
app.get('/api/external/companies', (req, res) => {
  if (req.headers['x-sync-secret'] !== syncSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json(companyStore.getAll());
});

app.get('/api/external/ebitda', async (req, res) => {
  if (req.headers['x-sync-secret'] !== syncSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { year, month, companyId } = req.query;
    const opts = companyId ? { companyId } : {};
    const data = await reportEngine.getEbitda(parseInt(year), parseInt(month), opts);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/external/income', async (req, res) => {
  if (req.headers['x-sync-secret'] !== syncSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { year, month, companyId } = req.query;
    const opts = companyId ? { companyId } : {};
    const data = await reportEngine.getEbitda(parseInt(year), parseInt(month), opts);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/external/balance', async (req, res) => {
  if (req.headers['x-sync-secret'] !== syncSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { year, month, companyId } = req.query;
    const opts = companyId ? { companyId } : {};
    const data = await reportEngine.getBalanceSheet(parseInt(year), parseInt(month), opts);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Protected: Dashboard & Admin =====
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// ===== Protected API Routes =====
app.get('/api/companies', requireAuth, (req, res) => {
  const companies = companyStore.getForUser(req.session.user);
  res.json(companies);
});
app.use('/api/admin', requireAuth, requireAdmin, adminRoutes);
app.use('/api/pipeline', requireAuth, pipelineRoutes);
app.use('/api/contacts', requireAuth, contactRoutes);
app.use('/api', requireAuth, companyAccess, createReportRoutes(reportEngine));
app.use('/docs', requireAuth, docsRoutes);

// ===== Static Files (CSS/JS assets — after route matching) =====
app.use(express.static(path.join(__dirname, '../public')));

// ===== Start Server (local) / Export (Vercel) =====
userStore.ensureDefaultAdmin().catch(() => {});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║  BC Financial Reporter                       ║
║  Server running on port ${PORT}                  ║
║                                              ║
║  Web:   http://localhost:${PORT}                 ║
║  API:   http://localhost:${PORT}/api             ║
║  LINE:  http://localhost:${PORT}/webhook/line    ║
╚══════════════════════════════════════════════╝
    `);
  });
}

module.exports = app;
