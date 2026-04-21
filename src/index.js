// src/index.js
// BC Financial Reporter — Main Entry Point

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const BCClient = require('./services/bcClient');
const ReportEngine = require('./services/reportEngine');
const LineBotService = require('./services/lineBot');
const userStore = require('./services/userStore');
const createReportRoutes = require('./routes/reports');
const docsRoutes = require('./routes/docs');
const authRoutes = require('./routes/auth');
const botAuthRoutes = require('./routes/botAuth');
const adminRoutes = require('./routes/admin');
const pipelineRoutes = require('./routes/pipeline');
const strategyRoutes = require('./routes/strategy');
const twStockRoutes = require('./routes/twStock');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const companyAccess = require('./middleware/companyAccess');
const { securityHeaders, corsConfig } = require('./middleware/security');
const { loginLimiter, apiLimiter, aiLimiter } = require('./middleware/rateLimiter');
const { auditLog, auditMiddleware } = require('./middleware/auditLog');
const companyStore = require('./services/companyStore');
const pipelineStore = require('./services/pipelineStore');
const contactStore = require('./services/contactStore');
const contactRoutes = require('./routes/contacts');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT;

// ===== Validate required secrets in production (規範 §2.2) =====
if (isProduction) {
  const required = ['SESSION_SECRET', 'SYNC_SECRET'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// ===== Initialize BC Client & Report Engine =====
const bcClient = new BCClient(process.env);
const reportEngine = new ReportEngine(bcClient);

// Share reportEngine with strategy routes for KPI calculations
app.locals.reportEngine = reportEngine;

// ===== Middleware =====
app.set('trust proxy', 1); // Trust Railway/Vercel reverse proxy for secure cookies
app.use(securityHeaders());   // Helmet: CSP, HSTS, X-Frame-Options (規範 §5.1)
app.use(corsConfig());        // CORS: env-based whitelist or allow-all in dev (規範 §5.1)
app.use(express.json({ limit: '10mb' }));
app.use(auditMiddleware);     // Access logging for API routes (規範 §7.1)
app.use(session({
  secret: process.env.SESSION_SECRET || 'bc-reporter-default-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,     // HTTPS only in production (規範 §5.1)
  },
}));

// ===== Public Routes (no auth) =====

function sendNoStoreFile(res, filePath) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(filePath);
}

// Login page
app.get('/login', (req, res) => {
  sendNoStoreFile(res, path.join(__dirname, '../public/login.html'));
});

// Auth API (login/logout/me) — with login rate limiting (規範 §5.1)
app.use('/auth/login', loginLimiter);
app.use('/auth', authRoutes);

// Bot auth page (LINE users bind their account via web)
app.get('/bot-auth', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/bot-auth.html'));
});
app.use('/api/bot-auth', botAuthRoutes);

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
      res.status(500).json({ error: 'Webhook processing failed' });
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
  auditLog('sync_export', req);
  // Strip password hashes from user data (規範 §5.2)
  const safeUsers = userStore.getAllRaw().map(({ passwordHash, ...user }) => user);
  res.json({
    users: safeUsers,
    pipeline: pipelineStore.getRawData(),
    contacts: contactStore.getRawData(),
  });
});

// ===== Sync Import (push pipeline/contacts data to production volume) =====
app.post('/api/sync/import-pipeline', express.json({ limit: '10mb' }), (req, res) => {
  if (req.headers['x-sync-secret'] !== syncSecret) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { leads, activities } = req.body;
    if (!leads) return res.status(400).json({ error: 'Missing leads' });
    const current = pipelineStore.getRawData();
    // Merge: add new leads (by id), update existing
    const existingIdxMap = new Map(current.leads.map((l, i) => [l.id, i]));
    let added = 0, updated = 0;
    for (const lead of leads) {
      const idx = existingIdxMap.get(lead.id);
      if (idx !== undefined) {
        current.leads[idx] = lead;
        updated++;
      } else {
        current.leads.push(lead);
        existingIdxMap.set(lead.id, current.leads.length - 1);
        added++;
      }
    }
    // Merge activities
    if (activities) {
      const existingActIds = new Set(current.activities.map(a => a.id));
      for (const act of activities) {
        if (!existingActIds.has(act.id)) {
          current.activities.push(act);
        }
      }
    }
    pipelineStore.setRawData(current);
    res.json({ success: true, added, updated, total_leads: current.leads.length, total_activities: current.activities.length });
  } catch (e) {
    console.error('[Sync Import] Error:', e.message);
    res.status(500).json({ error: 'Import failed' });
  }
});

// ===== External Report API (sync-secret auth, for telegram-gateway) =====
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
  } catch (e) { console.error('[API Error]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/external/income', async (req, res) => {
  if (req.headers['x-sync-secret'] !== syncSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { year, month, companyId } = req.query;
    const opts = companyId ? { companyId } : {};
    const data = await reportEngine.getIncomeStatement(parseInt(year), parseInt(month), opts);
    res.json(data);
  } catch (e) { console.error('[API Error]', e.message); res.status(500).json({ error: 'Internal server error' }); }
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
  } catch (e) { console.error('[API Error]', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

// ===== External: Pipeline (token-based) =====
app.get('/api/external/pipeline/leads', (req, res) => {
  if (req.headers['x-sync-secret'] !== syncSecret) return res.status(401).json({ error: 'Unauthorized' });
  const { salesperson, salespeople, status, category } = req.query;
  const filters = { status, category };
  if (salespeople) {
    filters.salespeople = salespeople.split(',').map(s => s.trim());
  } else if (salesperson) {
    filters.salesperson = salesperson;
  }
  res.json(pipelineStore.getLeads(filters));
});

app.get('/api/external/pipeline/dashboard', (req, res) => {
  if (req.headers['x-sync-secret'] !== syncSecret) return res.status(401).json({ error: 'Unauthorized' });
  const { salesperson, salespeople } = req.query;
  let filters = {};
  if (salespeople) {
    filters.salespeople = salespeople.split(',').map(s => s.trim());
  } else if (salesperson) {
    filters.salesperson = salesperson;
  }
  const leads = pipelineStore.getLeads(filters);
  const totalLeads = leads.length;
  const statusCounts = {};
  pipelineStore.STATUSES.forEach(s => { statusCounts[s] = 0; });
  leads.forEach(l => { statusCounts[l.status] = (statusCounts[l.status] || 0) + 1; });
  const totalValue = leads.reduce((s, l) => s + (l.estimatedValue || 0), 0);
  res.json({ totalLeads, statusCounts, totalValue });
});

app.get('/api/external/pipeline/activities', (req, res) => {
  if (req.headers['x-sync-secret'] !== syncSecret) return res.status(401).json({ error: 'Unauthorized' });
  const { leadId, weekLabel } = req.query;
  res.json(pipelineStore.getActivities({ leadId, weekLabel }));
});

app.post('/api/external/pipeline/leads', express.json(), (req, res) => {
  if (req.headers['x-sync-secret'] !== syncSecret) return res.status(401).json({ error: 'Unauthorized' });
  try { res.status(201).json(pipelineStore.createLead(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/external/pipeline/leads/:id', express.json(), (req, res) => {
  if (req.headers['x-sync-secret'] !== syncSecret) return res.status(401).json({ error: 'Unauthorized' });
  try { res.json(pipelineStore.updateLead(req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/external/pipeline/leads/:id/notes', express.json(), (req, res) => {
  if (req.headers['x-sync-secret'] !== syncSecret) return res.status(401).json({ error: 'Unauthorized' });
  try { res.status(201).json(pipelineStore.addLeadNote(req.params.id, req.body.content, req.body.author || 'bot')); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ===== External: Contacts (token-based) =====
app.get('/api/external/contacts', (req, res) => {
  if (req.headers['x-sync-secret'] !== syncSecret) return res.status(401).json({ error: 'Unauthorized' });
  res.json(contactStore.getAll());
});

app.get('/api/external/contacts/stats', (req, res) => {
  if (req.headers['x-sync-secret'] !== syncSecret) return res.status(401).json({ error: 'Unauthorized' });
  res.json(contactStore.getStats());
});

// ===== Protected: Dashboard & Admin =====
app.get('/', requireAuth, (req, res) => {
  sendNoStoreFile(res, path.join(__dirname, '../public/index.html'));
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
app.use('/api/strategy', requireAuth, strategyRoutes);
app.use('/api/tw-stock', requireAuth, twStockRoutes);
app.use('/api/contacts', requireAuth, aiLimiter, contactRoutes);
app.use('/api', requireAuth, companyAccess, createReportRoutes(reportEngine));
app.use('/docs', requireAuth, docsRoutes);

// ===== Static Files (CSS/JS assets — after route matching) =====
app.use(express.static(path.join(__dirname, '../public'), {
  etag: false,
  setHeaders: (res, filePath) => {
    // No-cache for HTML to prevent stale JS
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

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
