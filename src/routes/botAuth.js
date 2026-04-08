// src/routes/botAuth.js
// Bot OAuth-style login — LINE users authenticate via web page instead of typing credentials in chat

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const userStore = require('../services/userStore');

const router = express.Router();

// In-memory token store: token → { lineUserId, bot, createdAt }
const pendingTokens = new Map();
const TOKEN_TTL = 10 * 60 * 1000; // 10 minutes

// In-memory binding store: lineUserId → { username, displayName, boundAt }
// Persisted to data/bot-bindings.json
const fs = require('fs');
const BINDINGS_FILE = path.join(__dirname, '../../data/bot-bindings.json');

function loadBindings() {
  try {
    return JSON.parse(fs.readFileSync(BINDINGS_FILE, 'utf8'));
  } catch { return {}; }
}

function saveBindings(bindings) {
  const dir = path.dirname(BINDINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(BINDINGS_FILE, JSON.stringify(bindings, null, 2));
}

let bindings = loadBindings();

const SYNC_SECRET = process.env.SYNC_SECRET || '';

function requireInternalKey(req, res, next) {
  const key = req.headers['x-internal-key'] || req.query.key;
  if (!key || !SYNC_SECRET || key !== SYNC_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// Cleanup expired tokens periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of pendingTokens) {
    if (now - data.createdAt > TOKEN_TTL) pendingTokens.delete(token);
  }
}, 60 * 1000);

// POST /api/bot-auth/token — bot creates a one-time login token
router.post('/token', requireInternalKey, (req, res) => {
  const { lineUserId, bot } = req.body;
  if (!lineUserId) return res.status(400).json({ error: 'lineUserId required' });

  const token = crypto.randomBytes(32).toString('hex');
  pendingTokens.set(token, { lineUserId, bot: bot || '', createdAt: Date.now() });

  const url = `https://reports.velopulse.io/bot-auth?token=${token}`;
  res.json({ url, token, expiresIn: TOKEN_TTL / 1000 });
});

// GET /api/bot-auth/check/:lineUserId — bot checks if user is already bound
router.get('/check/:lineUserId', requireInternalKey, (req, res) => {
  const binding = bindings[req.params.lineUserId];
  if (binding) {
    return res.json({ bound: true, ...binding });
  }
  res.json({ bound: false });
});

// POST /api/bot-auth/verify — user submits credentials from web page
router.post('/verify', async (req, res) => {
  const { token, username, password } = req.body;
  if (!token || !username || !password) {
    return res.status(400).json({ error: '請填寫所有欄位' });
  }

  const pending = pendingTokens.get(token);
  if (!pending) {
    return res.status(400).json({ error: '連結已過期，請重新從 Bot 取得登入連結' });
  }

  if (Date.now() - pending.createdAt > TOKEN_TTL) {
    pendingTokens.delete(token);
    return res.status(400).json({ error: '連結已過期，請重新從 Bot 取得登入連結' });
  }

  // Verify credentials
  const user = await userStore.verifyPassword(username, password);
  if (!user) {
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }

  // Bind LINE userId to reports account
  bindings[pending.lineUserId] = {
    username: user.username,
    displayName: user.displayName || username,
    role: user.role,
    companies: user.companies,
    dashboards: user.dashboards,
    boundAt: new Date().toISOString(),
    bot: pending.bot,
  };
  saveBindings(bindings);

  // Consume token
  pendingTokens.delete(token);

  console.log(`[BotAuth] Bound ${pending.lineUserId} → ${user.username} (${pending.bot})`);
  res.json({ ok: true, displayName: user.displayName || username });
});

// POST /api/bot-auth/unbind — remove binding
router.post('/unbind', requireInternalKey, (req, res) => {
  const { lineUserId } = req.body;
  if (!lineUserId) return res.status(400).json({ error: 'lineUserId required' });
  delete bindings[lineUserId];
  saveBindings(bindings);
  res.json({ ok: true });
});

// POST /api/bot-auth/login — bot uses binding to get session cookie (no password needed)
router.post('/login', requireInternalKey, async (req, res) => {
  const { lineUserId } = req.body;
  if (!lineUserId) return res.status(400).json({ error: 'lineUserId required' });

  const binding = bindings[lineUserId];
  if (!binding) {
    return res.status(404).json({ error: 'not_bound', message: '尚未綁定，請先登入' });
  }

  // Return user info so bot can create session
  const user = userStore.findByUsername(binding.username);
  if (!user) {
    return res.status(404).json({ error: 'user_not_found', message: '帳號已不存在' });
  }
  if (user.disabled) {
    return res.status(403).json({ error: 'user_disabled', message: '帳號已停用' });
  }

  res.json({
    ok: true,
    user: {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      companies: user.companies,
      dashboards: user.dashboards,
    }
  });
});

module.exports = router;
