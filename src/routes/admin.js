// src/routes/admin.js
// Admin user management routes (requireAdmin)

const express = require('express');
const router = express.Router();
const userStore = require('../services/userStore');
const pipelineStore = require('../services/pipelineStore');
const expenseStore = require('../services/expenseStore');
const departmentStore = require('../services/departmentStore');

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

// GET /api/admin/expense-export — full expense workflow data for deployment sync
router.get('/expense-export', (req, res) => {
  res.json(expenseStore.getRawData());
});

// GET /api/admin/departments-export — full department master data
router.get('/departments-export', (req, res) => {
  res.json(departmentStore.getRawData());
});

// GET /api/admin/departments — list department names for user assignment
router.get('/departments', (req, res) => {
  res.json(departmentStore.list(req.query.companyId));
});

// GET /api/admin/departments/items — list full department master records
router.get('/departments/items', (req, res) => {
  res.json(departmentStore.listItems(req.query.companyId));
});

// POST /api/admin/departments — create department
router.post('/departments', (req, res) => {
  try {
    const department = departmentStore.create(req.body.companyId, req.body.name);
    res.status(201).json(department);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/admin/departments — rename / activate / deactivate department
router.put('/departments', async (req, res) => {
  try {
    const { companyId, originalName, name, active } = req.body;
    const updated = departmentStore.update(companyId, originalName, { name, active });
    if (updated.oldName !== updated.name) {
      const users = userStore.getAll().filter(u => u.department === updated.oldName);
      for (const user of users) {
        await userStore.update(user.id, { department: updated.name });
      }
    }
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/admin/departments — delete department if no users are assigned to it
router.delete('/departments', (req, res) => {
  try {
    const { companyId, name } = req.query;
    const assignedUsers = userStore.getAll().filter(u => u.department === name);
    if (assignedUsers.length) {
      return res.status(400).json({ error: `仍有 ${assignedUsers.length} 位使用者屬於此部門，請先調整使用者部門` });
    }
    departmentStore.delete(companyId, name);
    res.json({ status: 'deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/admin/salespeople — list users marked as sales
router.get('/salespeople', (req, res) => {
  const all = userStore.getAll();
  res.json(all.filter(u => u.isSales || u.role === 'manager'));
});

// POST /api/admin/users — create user
router.post('/users', async (req, res) => {
  try {
    const { username, password, role, displayName, department, companies, dashboards, managedSalespeople, canExport, isSales, strategyRole } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const user = await userStore.create({ username, password, role, displayName, department, companies, dashboards, managedSalespeople, canExport, isSales, strategyRole });
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
