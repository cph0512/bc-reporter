// src/routes/contacts.js
// API routes for business card / contacts module

const express = require('express');
const router = express.Router();
const contactStore = require('../services/contactStore');
const exporter = require('../services/contactExporter');
const geminiScanner = require('../services/geminiScanner');

// ===== Contacts CRUD =====

// GET /api/contacts — list contacts
router.get('/', (req, res) => {
  try {
    const filters = {};
    if (req.query.search) filters.search = req.query.search;
    if (req.query.category_id) filters.category_id = req.query.category_id;
    if (req.query.is_favorite === 'true') filters.is_favorite = true;
    if (req.query.created_by) filters.created_by = req.query.created_by;
    if (req.query.include_deleted === 'true') filters.include_deleted = true;
    const contacts = contactStore.getContacts(filters);
    res.json(contacts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/contacts/stats — statistics
router.get('/stats', (req, res) => {
  try {
    res.json(contactStore.getStats());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/contacts/categories — list categories
router.get('/categories', (req, res) => {
  try {
    res.json(contactStore.getCategories());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/contacts/categories — create category
router.post('/categories', (req, res) => {
  try {
    const cat = contactStore.createCategory({
      ...req.body,
      created_by: req.session?.user?.displayName || null,
    });
    res.status(201).json(cat);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PUT /api/contacts/categories/:id — update category
router.put('/categories/:id', (req, res) => {
  try {
    const cat = contactStore.updateCategory(req.params.id, req.body);
    res.json(cat);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// DELETE /api/contacts/categories/:id — soft delete category
router.delete('/categories/:id', (req, res) => {
  try {
    contactStore.deleteCategory(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PUT /api/contacts/categories/reorder — reorder categories
router.put('/categories/reorder', (req, res) => {
  try {
    const result = contactStore.reorderCategories(req.body.orderedIds);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/contacts/scan — scan single business card
router.post('/scan', async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    if (!image) return res.status(400).json({ error: '請提供名片圖片' });
    // Strip data URI prefix if present
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');
    const result = await geminiScanner.scanCard(base64, mimeType || 'image/jpeg');
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/contacts/scan-batch — scan multiple business cards
router.post('/scan-batch', async (req, res) => {
  try {
    const { images } = req.body;
    if (!images || !images.length) return res.status(400).json({ error: '請提供名片圖片' });
    if (images.length > 10) return res.status(400).json({ error: '最多 10 張圖片' });
    const prepared = images.map((img, i) => ({
      base64: img.image.replace(/^data:image\/\w+;base64,/, ''),
      mimeType: img.mimeType || 'image/jpeg',
      fileName: img.fileName || `image_${i + 1}`,
    }));
    const results = await geminiScanner.scanBatch(prepared);
    res.json({
      contacts: results,
      total_cards_found: results.filter(r => r.success).length,
      total_files: images.length,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/contacts/check-duplicates — duplicate detection
router.post('/check-duplicates', (req, res) => {
  try {
    const { contacts } = req.body;
    if (!contacts || !contacts.length) return res.status(400).json({ error: '請提供聯絡人資料' });
    const results = contacts.map(c => ({
      contact: c,
      duplicates: contactStore.findDuplicates(c),
    }));
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Export routes — must be before /:id
// GET /api/contacts/export/vcard
router.get('/export/vcard', (req, res) => {
  try {
    let contacts;
    if (req.query.id) {
      const c = contactStore.getContactById(req.query.id);
      if (!c) return res.status(404).json({ error: 'Contact not found' });
      contacts = [c];
    } else if (req.query.ids) {
      const ids = req.query.ids.split(',');
      contacts = ids.map(id => contactStore.getContactById(id)).filter(Boolean);
    } else {
      contacts = contactStore.getContacts();
    }
    const vcf = exporter.toVCardBatch(contacts);
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contacts_${Date.now()}.vcf"`);
    res.send(vcf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/contacts/export/csv
router.get('/export/csv', (req, res) => {
  try {
    let contacts;
    if (req.query.ids) {
      const ids = req.query.ids.split(',');
      contacts = ids.map(id => contactStore.getContactById(id)).filter(Boolean);
    } else {
      contacts = contactStore.getContacts();
    }
    const categories = contactStore.getCategories();
    const csv = exporter.toCSV(contacts, categories);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contacts_${Date.now()}.csv"`);
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/contacts/export/salesforce/:id
router.get('/export/salesforce/:id', (req, res) => {
  try {
    const contact = contactStore.getContactById(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    const script = exporter.toSalesforceScript(contact, req.query);
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.send(script);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/contacts — create contact
router.post('/', (req, res) => {
  try {
    const contact = contactStore.createContact({
      ...req.body,
      created_by: req.session?.user?.displayName || null,
    });
    res.status(201).json(contact);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/contacts/batch-delete — batch soft delete
router.post('/batch-delete', (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: '請提供聯絡人 ID' });
    const count = contactStore.batchDelete(ids);
    res.json({ success: true, deleted: count });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// GET /api/contacts/:id — single contact
router.get('/:id', (req, res) => {
  try {
    const contact = contactStore.getContactById(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json(contact);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/contacts/:id — update contact
router.put('/:id', (req, res) => {
  try {
    const contact = contactStore.updateContact(req.params.id, req.body);
    res.json(contact);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// DELETE /api/contacts/:id — soft delete
router.delete('/:id', (req, res) => {
  try {
    contactStore.deleteContact(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/contacts/:id/restore — restore soft-deleted
router.post('/:id/restore', (req, res) => {
  try {
    const contact = contactStore.restoreContact(req.params.id);
    res.json(contact);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// POST /api/contacts/:id/favorite — toggle favorite
router.post('/:id/favorite', (req, res) => {
  try {
    const contact = contactStore.toggleFavorite(req.params.id);
    res.json(contact);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
