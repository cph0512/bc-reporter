// src/routes/admin.js
// Admin user management routes (requireAdmin)

const express = require('express');
const router = express.Router();
const userStore = require('../services/userStore');
const pipelineStore = require('../services/pipelineStore');

// GET /api/admin/users — list all users (no password hashes)
router.get('/users', (req, res) => {
  res.json(userStore.getAll());
});

// GET /api/admin/users-export — full export for deployment sync (strips passwordHash)
router.get('/users-export', (req, res) => {
  res.json(userStore.getAll());
});

// GET /api/admin/pipeline-export — full pipeline data for deployment sync
router.get('/pipeline-export', (req, res) => {
  res.json(pipelineStore.getRawData());
});

// GET /api/admin/salespeople — list users marked as sales
router.get('/salespeople', (req, res) => {
  const all = userStore.getAll();
  res.json(all.filter(u => u.isSales || u.role === 'manager'));
});

// POST /api/admin/users — create user
router.post('/users', async (req, res) => {
  try {
    const { username, password, role, displayName, companies, dashboards, managedSalespeople } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const user = await userStore.create({ username, password, role, displayName, companies, dashboards, managedSalespeople });
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/admin/users/:id — update user
router.put('/users/:id', async (req, res) => {
  try {
    const user = await userStore.update(req.params.id, req.body);
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/admin/users/:id — delete user
router.delete('/users/:id', (req, res) => {
  try {
    if (req.params.id === req.session.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    userStore.delete(req.params.id);
    res.json({ status: 'deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
