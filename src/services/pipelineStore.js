// src/services/pipelineStore.js
// JSON-file backed pipeline store for leads + weekly activities

const fs = require('fs');
const path = require('path');

const PIPELINE_SRC = path.join(__dirname, '../../config/pipeline.json');
const PIPELINE_FILE = process.env.VERCEL ? '/tmp/pipeline.json' : PIPELINE_SRC;

// Vercel: copy bundled pipeline.json to writable /tmp on cold start
if (process.env.VERCEL && !fs.existsSync(PIPELINE_FILE) && fs.existsSync(PIPELINE_SRC)) {
  fs.copyFileSync(PIPELINE_SRC, PIPELINE_FILE);
}

const DEFAULT_STATUSES = ['初步接觸', '進行中', '報價', '已完成'];
const DEFAULT_CATEGORIES = ['客戶', '車隊', '車隊+客戶', '合作廠商', '倉儲客戶', '戰略合作夥伴', '系統商', '系統商+潛在合作對象'];

function readData() {
  try {
    if (!fs.existsSync(PIPELINE_FILE)) return { leads: [], activities: [], statuses: DEFAULT_STATUSES, categories: DEFAULT_CATEGORIES };
    const raw = JSON.parse(fs.readFileSync(PIPELINE_FILE, 'utf8'));
    return {
      leads: raw.leads || [],
      activities: raw.activities || [],
      statuses: raw.statuses || DEFAULT_STATUSES,
      categories: raw.categories || DEFAULT_CATEGORIES,
    };
  } catch { return { leads: [], activities: [], statuses: DEFAULT_STATUSES, categories: DEFAULT_CATEGORIES }; }
}

function writeData(data) {
  const dir = path.dirname(PIPELINE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PIPELINE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function nextLeadId(leads) {
  const max = leads.reduce((m, l) => {
    const n = parseInt(l.id.replace('lead_', ''), 10);
    return n > m ? n : m;
  }, 0);
  return `lead_${max + 1}`;
}

function nextActivityId(activities) {
  const max = activities.reduce((m, a) => {
    const n = parseInt(a.id.replace('act_', ''), 10);
    return n > m ? n : m;
  }, 0);
  return `act_${max + 1}`;
}

const pipelineStore = {
  // Dynamic getters — always read from file
  get STATUSES() { return readData().statuses; },
  get CATEGORIES() { return readData().categories; },

  // Full raw data export for deployment sync
  getRawData() {
    return readData();
  },

  // ===== Config =====

  getConfig() {
    const data = readData();
    return { statuses: data.statuses, categories: data.categories };
  },

  updateConfig({ statuses, categories }) {
    const data = readData();
    if (statuses !== undefined) {
      if (!Array.isArray(statuses) || statuses.length === 0) throw new Error('至少需要一個狀態');
      data.statuses = statuses.map(s => s.trim()).filter(Boolean);
    }
    if (categories !== undefined) {
      if (!Array.isArray(categories) || categories.length === 0) throw new Error('至少需要一個類別');
      data.categories = categories.map(c => c.trim()).filter(Boolean);
    }
    writeData(data);
    return { statuses: data.statuses, categories: data.categories };
  },

  // ===== Leads =====

  getLeads(filters = {}) {
    let { leads } = readData();
    if (filters.salesperson) {
      leads = leads.filter(l => l.salesperson === filters.salesperson);
    }
    if (filters.status) {
      leads = leads.filter(l => l.status === filters.status);
    }
    if (filters.category) {
      leads = leads.filter(l => l.category === filters.category);
    }
    return leads;
  },

  getLeadById(id) {
    const { leads } = readData();
    return leads.find(l => l.id === id) || null;
  },

  createLead({ companyName, salesperson, status, category, notes, estimatedValue, contactName, contactEmail, leadDate, createdBy }) {
    if (!companyName || !companyName.trim()) {
      throw new Error('公司/客戶名稱為必填');
    }
    const data = readData();
    const now = new Date().toISOString();
    const lead = {
      id: nextLeadId(data.leads),
      companyName: companyName.trim(),
      salesperson: (salesperson || '').trim(),
      status: (status || '').trim() || data.statuses[0],
      category: (category || '').trim(),
      notes: (notes || '').trim(),
      estimatedValue: estimatedValue != null ? Number(estimatedValue) : null,
      contactName: (contactName || '').trim(),
      contactEmail: (contactEmail || '').trim(),
      leadDate: leadDate || null,
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now,
      createdBy: createdBy || null,
    };
    data.leads.push(lead);
    writeData(data);
    return lead;
  },

  updateLead(id, fields) {
    const data = readData();
    const idx = data.leads.findIndex(l => l.id === id);
    if (idx === -1) throw new Error('Lead not found');

    const lead = data.leads[idx];
    if (fields.companyName !== undefined) lead.companyName = fields.companyName.trim();
    if (fields.salesperson !== undefined) lead.salesperson = (fields.salesperson || '').trim();
    const oldStatus = lead.status;
    if (fields.status !== undefined) lead.status = (fields.status || '').trim() || lead.status;
    if (fields.category !== undefined) lead.category = (fields.category || '').trim();
    if (fields.notes !== undefined) lead.notes = (fields.notes || '').trim();
    if (fields.estimatedValue !== undefined) {
      lead.estimatedValue = fields.estimatedValue != null ? Number(fields.estimatedValue) : null;
    }
    if (fields.contactName !== undefined) lead.contactName = (fields.contactName || '').trim();
    if (fields.contactEmail !== undefined) lead.contactEmail = (fields.contactEmail || '').trim();
    if (fields.leadDate !== undefined) lead.leadDate = fields.leadDate || null;
    const now = new Date().toISOString();
    lead.updatedAt = now;
    // Track status change timestamp
    if (lead.status !== oldStatus) {
      lead.statusChangedAt = now;
    }

    writeData(data);
    return lead;
  },

  addLeadNote(id, content, createdBy) {
    const data = readData();
    const lead = data.leads.find(l => l.id === id);
    if (!lead) throw new Error('Lead not found');
    if (!content || !content.trim()) throw new Error('備註內容不可為空');
    if (!lead.noteLog) lead.noteLog = [];
    lead.noteLog.push({
      content: content.trim(),
      createdAt: new Date().toISOString(),
      createdBy: createdBy || null,
    });
    writeData(data);
    return lead;
  },

  deleteLead(id) {
    const data = readData();
    const idx = data.leads.findIndex(l => l.id === id);
    if (idx === -1) throw new Error('Lead not found');
    data.leads.splice(idx, 1);
    // Also delete associated activities
    data.activities = data.activities.filter(a => a.leadId !== id);
    writeData(data);
  },

  // ===== Activities (週回顧) =====

  getActivities(filters = {}) {
    let { activities } = readData();
    if (filters.leadId) {
      activities = activities.filter(a => a.leadId === filters.leadId);
    }
    if (filters.weekLabel) {
      activities = activities.filter(a => a.weekLabel === filters.weekLabel);
    }
    return activities;
  },

  createActivity({ leadId, weekLabel, content, createdBy }) {
    if (!leadId) throw new Error('leadId is required');
    if (!weekLabel) throw new Error('weekLabel is required');
    const data = readData();
    // Verify lead exists
    if (!data.leads.find(l => l.id === leadId)) {
      throw new Error('Lead not found');
    }
    const now = new Date().toISOString();
    const activity = {
      id: nextActivityId(data.activities),
      leadId,
      weekLabel: weekLabel.trim(),
      content: (content || '').trim(),
      createdAt: now,
      createdBy: createdBy || null,
    };
    data.activities.push(activity);
    writeData(data);
    return activity;
  },

  updateActivity(id, fields) {
    const data = readData();
    const idx = data.activities.findIndex(a => a.id === id);
    if (idx === -1) throw new Error('Activity not found');

    const activity = data.activities[idx];
    if (fields.content !== undefined) activity.content = (fields.content || '').trim();
    if (fields.weekLabel !== undefined) activity.weekLabel = fields.weekLabel.trim();

    writeData(data);
    return activity;
  },

  deleteActivity(id) {
    const data = readData();
    const idx = data.activities.findIndex(a => a.id === id);
    if (idx === -1) throw new Error('Activity not found');
    data.activities.splice(idx, 1);
    writeData(data);
  },
};

module.exports = pipelineStore;
