// src/routes/auth.js
// Public authentication routes (login, logout, me)

const express = require('express');
const router = express.Router();
const userStore = require('../services/userStore');

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const user = await userStore.verifyPassword(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    req.session.user = user;
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ status: 'ok' });
  });
});

// POST /auth/change-password
router.post('/change-password', async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    const verified = await userStore.verifyPassword(req.session.user.username, currentPassword);
    if (!verified) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await userStore.update(req.session.user.id, { password: newPassword });
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /auth/me
router.get('/me', (req, res) => {
  if (req.session?.user) {
    return res.json({ user: req.session.user });
  }
  res.status(401).json({ error: 'Not authenticated' });
});

module.exports = router;
