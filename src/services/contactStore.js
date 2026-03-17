// src/services/contactStore.js
// JSON-file backed contact store for business card / address book module

const fs = require('fs');
const path = require('path');

const CONTACTS_SRC = path.join(__dirname, '../../config/contacts.json');
const CONTACTS_FILE = process.env.VERCEL ? '/tmp/contacts.json' : CONTACTS_SRC;

// Copy bundled data to writable location on cold start
if (process.env.VERCEL && !fs.existsSync(CONTACTS_FILE) && fs.existsSync(CONTACTS_SRC)) {
  fs.copyFileSync(CONTACTS_SRC, CONTACTS_FILE);
}

const DEFAULT_CATEGORIES = [
  { id: 'ccat_1', name: '客戶', color: '#1565c0', icon: 'briefcase', sort_order: 1, created_by: null, is_active: true },
  { id: 'ccat_2', name: '供應商', color: '#2e7d32', icon: 'truck', sort_order: 2, created_by: null, is_active: true },
  { id: 'ccat_3', name: '合作夥伴', color: '#e65100', icon: 'handshake', sort_order: 3, created_by: null, is_active: true },
  { id: 'ccat_4', name: '同業', color: '#7b1fa2', icon: 'users', sort_order: 4, created_by: null, is_active: true },
  { id: 'ccat_5', name: '其他', color: '#6b7280', icon: 'tag', sort_order: 5, created_by: null, is_active: true },
];

function readData() {
  try {
    if (!fs.existsSync(CONTACTS_FILE)) return { contacts: [], categories: DEFAULT_CATEGORIES };
    const raw = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
    return {
      contacts: raw.contacts || [],
      categories: raw.categories || DEFAULT_CATEGORIES,
    };
  } catch { return { contacts: [], categories: DEFAULT_CATEGORIES }; }
}

function writeData(data) {
  const dir = path.dirname(CONTACTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function nextContactId(contacts) {
  const max = contacts.reduce((m, c) => {
    const n = parseInt(c.id.replace('con_', ''), 10);
    return n > m ? n : m;
  }, 0);
  return `con_${max + 1}`;
}

function nextCategoryId(categories) {
  const max = categories.reduce((m, c) => {
    const n = parseInt(c.id.replace('ccat_', ''), 10);
    return n > m ? n : m;
  }, 0);
  return `ccat_${max + 1}`;
}

// Normalize phone for comparison: strip non-digits
function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '');
}

const contactStore = {
  getRawData() {
    return readData();
  },

  // ===== Contacts =====

  getContacts(filters = {}) {
    const data = readData();
    let contacts = data.contacts.filter(c => c.is_active !== false);

    if (filters.include_deleted) {
      contacts = data.contacts; // return all including soft-deleted
    }
    if (filters.category_id) {
      contacts = contacts.filter(c => c.category_id === filters.category_id);
    }
    if (filters.is_favorite) {
      contacts = contacts.filter(c => c.is_favorite === true);
    }
    if (filters.created_by) {
      contacts = contacts.filter(c => c.created_by === filters.created_by);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      contacts = contacts.filter(c => {
        const fields = [
          c.full_name, c.company, c.job_title, c.address, c.department,
          ...(c.emails || []).map(e => e.value),
          ...(c.phones || []).map(p => p.value),
        ].filter(Boolean).map(f => f.toLowerCase());
        return fields.some(f => f.includes(q));
      });
    }
    if (filters.tags && filters.tags.length) {
      contacts = contacts.filter(c =>
        (c.tags || []).some(t => filters.tags.includes(t))
      );
    }

    // Sort by created_at desc (newest first)
    contacts.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return contacts;
  },

  getContactById(id) {
    const { contacts } = readData();
    return contacts.find(c => c.id === id) || null;
  },

  getStats() {
    const data = readData();
    const active = data.contacts.filter(c => c.is_active !== false);
    const categories = data.categories.filter(c => c.is_active !== false);
    const catStats = categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      color: cat.color,
      count: active.filter(c => c.category_id === cat.id).length,
    }));
    const uncategorized = active.filter(c => !c.category_id).length;
    return {
      total: active.length,
      favorites: active.filter(c => c.is_favorite).length,
      byCategory: catStats,
      uncategorized,
    };
  },

  createContact(fields) {
    if (!fields.full_name || !fields.full_name.trim()) {
      throw new Error('全名（full_name）為必填');
    }
    const data = readData();
    const now = new Date().toISOString();
    const contact = {
      id: nextContactId(data.contacts),
      full_name: (fields.full_name || '').trim(),
      first_name: (fields.first_name || '').trim(),
      last_name: (fields.last_name || '').trim(),
      company: (fields.company || '').trim(),
      job_title: (fields.job_title || '').trim(),
      department: (fields.department || '').trim(),
      emails: Array.isArray(fields.emails) ? fields.emails : [],
      phones: Array.isArray(fields.phones) ? fields.phones : [],
      address: (fields.address || '').trim(),
      website: (fields.website || '').trim(),
      social_profiles: fields.social_profiles || {},
      category_id: fields.category_id || null,
      tags: Array.isArray(fields.tags) ? fields.tags : [],
      source_type: fields.source_type || 'manual',
      source_image_url: fields.source_image_url || null,
      ai_raw_result: fields.ai_raw_result || null,
      ai_confidence: fields.ai_confidence != null ? Number(fields.ai_confidence) : null,
      ai_suggested_category: fields.ai_suggested_category || null,
      crm_sync_status: 'none',
      notes: (fields.notes || '').trim(),
      is_active: true,
      is_favorite: false,
      created_by: fields.created_by || null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };

    // If overwrite_id provided, replace existing contact
    if (fields.overwrite_id) {
      const idx = data.contacts.findIndex(c => c.id === fields.overwrite_id);
      if (idx !== -1) {
        contact.id = fields.overwrite_id;
        contact.created_at = data.contacts[idx].created_at; // preserve original create time
        data.contacts[idx] = contact;
        writeData(data);
        return contact;
      }
    }

    data.contacts.push(contact);
    writeData(data);
    return contact;
  },

  updateContact(id, fields) {
    const data = readData();
    const idx = data.contacts.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Contact not found');

    const contact = data.contacts[idx];
    const updatable = [
      'full_name', 'first_name', 'last_name', 'company', 'job_title',
      'department', 'address', 'website', 'notes', 'category_id',
    ];
    updatable.forEach(key => {
      if (fields[key] !== undefined) contact[key] = typeof fields[key] === 'string' ? fields[key].trim() : fields[key];
    });
    if (fields.emails !== undefined) contact.emails = fields.emails;
    if (fields.phones !== undefined) contact.phones = fields.phones;
    if (fields.social_profiles !== undefined) contact.social_profiles = fields.social_profiles;
    if (fields.tags !== undefined) contact.tags = fields.tags;
    if (fields.crm_sync_status !== undefined) contact.crm_sync_status = fields.crm_sync_status;

    contact.updated_at = new Date().toISOString();
    writeData(data);
    return contact;
  },

  deleteContact(id) {
    const data = readData();
    const contact = data.contacts.find(c => c.id === id);
    if (!contact) throw new Error('Contact not found');
    contact.is_active = false;
    contact.deleted_at = new Date().toISOString();
    writeData(data);
  },

  restoreContact(id) {
    const data = readData();
    const contact = data.contacts.find(c => c.id === id);
    if (!contact) throw new Error('Contact not found');
    contact.is_active = true;
    contact.deleted_at = null;
    writeData(data);
    return contact;
  },

  hardDeleteContact(id) {
    const data = readData();
    const idx = data.contacts.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Contact not found');
    data.contacts.splice(idx, 1);
    writeData(data);
  },

  toggleFavorite(id) {
    const data = readData();
    const contact = data.contacts.find(c => c.id === id);
    if (!contact) throw new Error('Contact not found');
    contact.is_favorite = !contact.is_favorite;
    contact.updated_at = new Date().toISOString();
    writeData(data);
    return contact;
  },

  batchDelete(ids) {
    const data = readData();
    const now = new Date().toISOString();
    let count = 0;
    ids.forEach(id => {
      const contact = data.contacts.find(c => c.id === id);
      if (contact && contact.is_active !== false) {
        contact.is_active = false;
        contact.deleted_at = now;
        count++;
      }
    });
    writeData(data);
    return count;
  },

  // ===== Duplicate Detection =====

  findDuplicates(contactData) {
    const data = readData();
    const active = data.contacts.filter(c => c.is_active !== false);
    const results = [];

    active.forEach(existing => {
      const reasons = [];

      // Name match (case-insensitive)
      if (contactData.full_name && existing.full_name &&
          contactData.full_name.trim().toLowerCase() === existing.full_name.trim().toLowerCase()) {
        reasons.push('姓名相同');
      }

      // Email match
      const newEmails = (contactData.emails || []).map(e => e.value.toLowerCase());
      const existEmails = (existing.emails || []).map(e => e.value.toLowerCase());
      if (newEmails.some(e => existEmails.includes(e))) {
        reasons.push('Email 相同');
      }

      // Phone match (normalize)
      const newPhones = (contactData.phones || []).map(p => normalizePhone(p.value)).filter(p => p.length >= 6);
      const existPhones = (existing.phones || []).map(p => normalizePhone(p.value)).filter(p => p.length >= 6);
      if (newPhones.some(p => existPhones.includes(p))) {
        reasons.push('電話相同');
      }

      if (reasons.length > 0) {
        results.push({ contact: existing, reasons });
      }
    });

    return results;
  },

  // ===== Categories =====

  getCategories() {
    const { categories } = readData();
    return categories
      .filter(c => c.is_active !== false)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  },

  createCategory({ name, color, icon, created_by }) {
    if (!name || !name.trim()) throw new Error('分類名稱為必填');
    const data = readData();
    const cat = {
      id: nextCategoryId(data.categories),
      name: name.trim(),
      color: (color || '#6b7280').trim(),
      icon: (icon || 'tag').trim(),
      sort_order: data.categories.length + 1,
      created_by: created_by || null,
      is_active: true,
    };
    data.categories.push(cat);
    writeData(data);
    return cat;
  },

  updateCategory(id, fields) {
    const data = readData();
    const cat = data.categories.find(c => c.id === id);
    if (!cat) throw new Error('Category not found');
    if (fields.name !== undefined) cat.name = fields.name.trim();
    if (fields.color !== undefined) cat.color = fields.color.trim();
    if (fields.icon !== undefined) cat.icon = fields.icon.trim();
    if (fields.sort_order !== undefined) cat.sort_order = fields.sort_order;
    writeData(data);
    return cat;
  },

  deleteCategory(id) {
    const data = readData();
    const cat = data.categories.find(c => c.id === id);
    if (!cat) throw new Error('Category not found');
    cat.is_active = false;
    writeData(data);
  },

  reorderCategories(orderedIds) {
    const data = readData();
    orderedIds.forEach((id, i) => {
      const cat = data.categories.find(c => c.id === id);
      if (cat) cat.sort_order = i + 1;
    });
    writeData(data);
    return this.getCategories();
  },
};

module.exports = contactStore;
