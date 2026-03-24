// src/routes/pipeline.js
// Sales Pipeline CRUD + Dashboard API

const express = require('express');
const router = express.Router();
const pipelineStore = require('../services/pipelineStore');
const { requireDashboard } = require('../middleware/auth');

// All pipeline routes require 'pipeline' dashboard access
router.use(requireDashboard('pipeline'));

// Helper: check if user is admin
function isAdmin(req) {
  return req.session?.user?.role === 'admin';
}

// Helper: get current user's display name (used as salesperson/owner)
function getUserName(req) {
  const user = req.session?.user;
  return user?.displayName || user?.username || null;
}

// Helper: check if user can access a lead (admin or own lead)
function canAccessLead(req, lead) {
  if (isAdmin(req)) return true;
  const name = getUserName(req);
  return lead.salesperson === name || lead.createdBy === req.session?.user?.id;
}

// ===== Config =====
router.get('/config', (req, res) => {
  res.json(pipelineStore.getConfig());
});

// PUT /config — update statuses/categories (admin only)
router.put('/config', (req, res) => {
  try {
    if (req.session?.user?.role !== 'admin') {
      return res.status(403).json({ error: '僅管理員可修改設定' });
    }
    const config = pipelineStore.updateConfig(req.body);
    res.json(config);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== Leads CRUD =====

// GET /leads — list with optional filters
router.get('/leads', (req, res) => {
  try {
    const { salesperson, status, category } = req.query;
    const filters = { status, category };
    if (isAdmin(req)) {
      // Admin: can filter by salesperson, or see all
      if (salesperson) filters.salesperson = salesperson;
    } else {
      // Non-admin: always filter to own leads only
      filters.salesperson = getUserName(req);
    }
    const leads = pipelineStore.getLeads(filters);
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /leads — create
router.post('/leads', (req, res) => {
  try {
    const lead = pipelineStore.createLead({
      ...req.body,
      createdBy: req.session?.user?.id || null,
    });
    res.status(201).json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /leads/:id — update
router.put('/leads/:id', (req, res) => {
  try {
    const existing = pipelineStore.getLeadById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Lead not found' });
    if (!canAccessLead(req, existing)) return res.status(403).json({ error: 'No permission' });
    const lead = pipelineStore.updateLead(req.params.id, req.body);
    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /leads/:id — delete
router.delete('/leads/:id', (req, res) => {
  try {
    const existing = pipelineStore.getLeadById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Lead not found' });
    if (!canAccessLead(req, existing)) return res.status(403).json({ error: 'No permission' });
    pipelineStore.deleteLead(req.params.id);
    res.json({ status: 'deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /leads/:id/notes — add a note to lead's noteLog
router.post('/leads/:id/notes', (req, res) => {
  try {
    const lead = pipelineStore.addLeadNote(req.params.id, req.body.content, req.session?.user?.displayName || null);
    res.status(201).json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== Activities (週回顧) CRUD =====

// GET /activities — list with optional filters
router.get('/activities', (req, res) => {
  try {
    const { leadId, weekLabel } = req.query;
    let activities = pipelineStore.getActivities({ leadId, weekLabel });
    // Non-admin: only see activities for own leads
    if (!isAdmin(req)) {
      const name = getUserName(req);
      const ownLeadIds = new Set(
        pipelineStore.getLeads({ salesperson: name }).map(l => l.id)
      );
      activities = activities.filter(a => ownLeadIds.has(a.leadId));
    }
    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /activities — create
router.post('/activities', (req, res) => {
  try {
    const activity = pipelineStore.createActivity({
      ...req.body,
      createdBy: req.session?.user?.id || null,
    });
    res.status(201).json(activity);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /activities/:id — update
router.put('/activities/:id', (req, res) => {
  try {
    const activity = pipelineStore.updateActivity(req.params.id, req.body);
    res.json(activity);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /activities/:id — delete
router.delete('/activities/:id', (req, res) => {
  try {
    pipelineStore.deleteActivity(req.params.id);
    res.json({ status: 'deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== Dashboard =====

// GET /dashboard — compute KPIs + charts from pipeline data
router.get('/dashboard', (req, res) => {
  try {
    const { salesperson } = req.query;
    let filters = {};
    if (isAdmin(req)) {
      if (salesperson) filters.salesperson = salesperson;
    } else {
      // Non-admin: always scoped to own data
      filters.salesperson = getUserName(req);
    }
    const leads = pipelineStore.getLeads(filters);

    // KPIs
    const totalLeads = leads.length;
    const statusCounts = {};
    pipelineStore.STATUSES.forEach(s => { statusCounts[s] = 0; });
    leads.forEach(l => { statusCounts[l.status] = (statusCounts[l.status] || 0) + 1; });

    const completedCount = statusCounts['已完成'] || 0;
    const totalValue = leads.reduce((s, l) => s + (l.estimatedValue || 0), 0);
    const conversionRate = totalLeads > 0 ? completedCount / totalLeads : 0;

    // Charts
    // 1. Funnel (status distribution)
    const funnel = pipelineStore.STATUSES.map(s => ({ name: s, value: statusCounts[s] || 0 }));

    // 2. Leads by salesperson
    const bySP = {};
    leads.forEach(l => {
      const sp = l.salesperson || '未指定';
      bySP[sp] = (bySP[sp] || 0) + 1;
    });
    const leadsBySalesperson = Object.entries(bySP)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // 3. Leads by category
    const byCat = {};
    leads.forEach(l => {
      const cat = l.category || '未分類';
      byCat[cat] = (byCat[cat] || 0) + 1;
    });
    const leadsByCategory = Object.entries(byCat)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // 4. Pipeline value by status
    const valByStatus = {};
    pipelineStore.STATUSES.forEach(s => { valByStatus[s] = 0; });
    leads.forEach(l => {
      valByStatus[l.status] = (valByStatus[l.status] || 0) + (l.estimatedValue || 0);
    });
    const pipelineValueByStatus = pipelineStore.STATUSES.map(s => ({ name: s, value: valByStatus[s] }));

    res.json({
      kpis: { totalLeads, completedCount, totalValue, conversionRate, statusCounts },
      charts: { funnel, leadsBySalesperson, leadsByCategory, pipelineValueByStatus },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
