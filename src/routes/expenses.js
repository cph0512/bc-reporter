// src/routes/expenses.js
// Expense claim workflow API.

const express = require('express');
const router = express.Router();
const expenseStore = require('../services/expenseStore');
const expenseScanner = require('../services/expenseScanner');
const companyStore = require('../services/companyStore');
const departmentStore = require('../services/departmentStore');
const { requireDashboard } = require('../middleware/auth');

router.use(requireDashboard('expense'));

function isAdmin(req) {
  return req.session?.user?.role === 'admin';
}

function isManager(req) {
  return req.session?.user?.role === 'manager';
}

function isFinance(req) {
  return isAdmin(req) || req.session?.user?.strategyRole === 'finance_editor';
}

function getUserName(req) {
  const user = req.session?.user;
  return user?.displayName || user?.username || null;
}

function getVisibleApplicants(req) {
  const names = [getUserName(req)];
  const managed = req.session?.user?.managedSalespeople || [];
  names.push(...managed);
  return [...new Set(names.filter(Boolean))];
}

function canUseCompany(req, companyId) {
  if (!companyId) return false;
  if (!companyStore.findById(companyId)) return false;
  const companies = req.session?.user?.companies || [];
  return companies.length === 0 || companies.includes(companyId);
}

function canAccessClaim(req, claim) {
  if (isAdmin(req)) return true;
  const user = req.session?.user;
  if (claim.applicantId && claim.applicantId === user?.id) return true;
  const visible = getVisibleApplicants(req);
  if (isManager(req) && (visible.includes(claim.applicantName) || visible.includes(claim.salesperson))) return true;
  if (isFinance(req) && ['manager_approved', 'finance_approved', 'paid'].includes(claim.status)) return true;
  return false;
}

function canEditClaim(req, claim) {
  if (isAdmin(req)) return true;
  return claim.applicantId === req.session?.user?.id && ['draft', 'rejected'].includes(claim.status);
}

function canManagerApprove(req, claim) {
  if (isAdmin(req)) return true;
  if (!isManager(req) || claim.status !== 'submitted') return false;
  if (claim.applicantId === req.session?.user?.id) return false;
  const visible = getVisibleApplicants(req);
  return visible.includes(claim.applicantName) || visible.includes(claim.salesperson);
}

function canFinanceApprove(req) {
  return isFinance(req);
}

function scopedClaims(req, filters = {}) {
  let claims = expenseStore.list(filters);
  if (isAdmin(req)) return claims;

  if (isManager(req)) {
    const visible = new Set(getVisibleApplicants(req));
    claims = claims.filter(claim => (
      claim.applicantId === req.session?.user?.id ||
      visible.has(claim.applicantName) ||
      visible.has(claim.salesperson) ||
      (isFinance(req) && ['manager_approved', 'finance_approved', 'paid'].includes(claim.status))
    ));
  } else {
    claims = claims.filter(claim => claim.applicantId === req.session?.user?.id);
  }
  return claims;
}

router.get('/config', (req, res) => {
  const { companyId } = req.query;
  if (companyId && !canUseCompany(req, companyId)) return res.status(403).json({ error: 'No access to this company' });
  res.json({
    statuses: expenseStore.STATUSES,
    paymentMethods: expenseStore.PAYMENT_METHODS,
    departments: departmentStore.list(companyId),
  });
});

router.get('/summary', (req, res) => {
  const { companyId } = req.query;
  if (companyId && !canUseCompany(req, companyId)) return res.status(403).json({ error: 'No access to this company' });
  const claims = scopedClaims(req, { companyId });
  res.json(expenseStore.summary(claims));
});

router.post('/scan', async (req, res) => {
  try {
    const { images, image, mimeType, fileName, companyId } = req.body;
    if (companyId && !canUseCompany(req, companyId)) return res.status(403).json({ error: 'No access to this company' });

    const sourceImages = Array.isArray(images) && images.length
      ? images
      : (image ? [{ image, mimeType, fileName }] : []);
    if (!sourceImages.length) return res.status(400).json({ error: '請提供要辨識的圖片附件' });
    if (sourceImages.length > 5) return res.status(400).json({ error: '一次最多辨識 5 張圖片' });

    const prepared = sourceImages.map((img, index) => {
      const type = img.mimeType || 'image/jpeg';
      if (!String(type).startsWith('image/')) {
        throw new Error(`第 ${index + 1} 個附件不是圖片，暫不支援辨識`);
      }
      return {
        base64: String(img.image || '').replace(/^data:image\/[\w.+-]+;base64,/, ''),
        mimeType: type,
        fileName: img.fileName || `receipt_${index + 1}`,
      };
    });

    const results = await expenseScanner.scanExpenseBatch(prepared);
    const successful = results.filter(r => r.success);
    res.json({
      results,
      items: successful.flatMap(r => r.items || []),
      suggestions: {
        payee: successful.find(r => r.payee)?.payee || '',
        department: successful.find(r => r.department)?.department || '',
        requestDate: successful.find(r => r.requestDate)?.requestDate || '',
        payment: successful.find(r => r.payment && Object.keys(r.payment).length)?.payment || {},
      },
      totalFiles: results.length,
      totalRecognized: successful.length,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  try {
    const { companyId, status, scope } = req.query;
    if (companyId && !canUseCompany(req, companyId)) return res.status(403).json({ error: 'No access to this company' });
    const filters = { companyId, status };
    let claims = scopedClaims(req, filters);

    if (scope === 'mine') claims = claims.filter(c => c.applicantId === req.session?.user?.id);
    if (scope === 'manager') claims = claims.filter(c => c.status === 'submitted');
    if (scope === 'finance') claims = claims.filter(c => ['manager_approved', 'finance_approved'].includes(c.status));

    res.json(claims);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const claim = expenseStore.getById(req.params.id);
  if (!claim) return res.status(404).json({ error: 'Expense claim not found' });
  if (!canAccessClaim(req, claim)) return res.status(403).json({ error: 'No permission' });
  res.json(claim);
});

router.post('/', (req, res) => {
  try {
    const companyId = req.body.companyId;
    if (!canUseCompany(req, companyId)) return res.status(403).json({ error: 'No access to this company' });
    const claim = expenseStore.create(req.body, req.session.user);
    res.status(201).json(claim);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const existing = expenseStore.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Expense claim not found' });
    if (!canEditClaim(req, existing)) return res.status(403).json({ error: 'No permission' });
    const companyId = req.body.companyId || existing.companyId;
    if (!canUseCompany(req, companyId)) return res.status(403).json({ error: 'No access to this company' });
    const claim = expenseStore.update(req.params.id, req.body, req.session.user);
    res.json(claim);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const existing = expenseStore.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Expense claim not found' });
    if (!canEditClaim(req, existing)) return res.status(403).json({ error: 'No permission' });
    expenseStore.delete(req.params.id);
    res.json({ status: 'deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/submit', (req, res) => {
  try {
    const existing = expenseStore.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Expense claim not found' });
    if (!canEditClaim(req, existing)) return res.status(403).json({ error: 'No permission' });
    res.json(expenseStore.transition(req.params.id, 'submit', req.session.user, req.body.comment));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/manager-approve', (req, res) => {
  try {
    const existing = expenseStore.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Expense claim not found' });
    if (!canManagerApprove(req, existing)) return res.status(403).json({ error: 'No permission' });
    res.json(expenseStore.transition(req.params.id, 'manager_approve', req.session.user, req.body.comment));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/finance-approve', (req, res) => {
  try {
    const existing = expenseStore.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Expense claim not found' });
    if (!canFinanceApprove(req) || existing.status !== 'manager_approved') return res.status(403).json({ error: 'No permission' });
    res.json(expenseStore.transition(req.params.id, 'finance_approve', req.session.user, req.body.comment));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/paid', (req, res) => {
  try {
    const existing = expenseStore.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Expense claim not found' });
    if (!canFinanceApprove(req)) return res.status(403).json({ error: 'No permission' });
    res.json(expenseStore.transition(req.params.id, 'paid', req.session.user, req.body.comment));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/reject', (req, res) => {
  try {
    const existing = expenseStore.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Expense claim not found' });
    const allowed = canManagerApprove(req, existing) || (canFinanceApprove(req) && ['manager_approved', 'finance_approved'].includes(existing.status));
    if (!allowed) return res.status(403).json({ error: 'No permission' });
    res.json(expenseStore.transition(req.params.id, 'reject', req.session.user, req.body.comment));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/attachments', (req, res) => {
  try {
    const existing = expenseStore.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Expense claim not found' });
    if (!canEditClaim(req, existing) && !canFinanceApprove(req)) return res.status(403).json({ error: 'No permission' });
    const attachment = expenseStore.addAttachment(req.params.id, req.body, req.session.user);
    res.status(201).json(attachment);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/attachments/:attachmentId', (req, res) => {
  try {
    const existing = expenseStore.getById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Expense claim not found' });
    if (!canEditClaim(req, existing) && !canFinanceApprove(req)) return res.status(403).json({ error: 'No permission' });
    expenseStore.deleteAttachment(req.params.id, req.params.attachmentId, req.session.user);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
