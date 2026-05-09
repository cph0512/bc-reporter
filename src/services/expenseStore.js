// src/services/expenseStore.js
// JSON-file backed expense claim store with approval workflow.

const fs = require('fs');
const path = require('path');
const { resolveDataFile } = require('./dataDir');

const EXPENSE_FILE = resolveDataFile('expenses.json');

const STATUSES = ['draft', 'submitted', 'manager_approved', 'finance_approved', 'paid', 'rejected'];
const PAYMENT_METHODS = ['匯款', '現金', '支票', '繳款單', '其他'];

function nowIso() {
  return new Date().toISOString();
}

function readData() {
  try {
    if (!fs.existsSync(EXPENSE_FILE)) return { claims: [] };
    const raw = JSON.parse(fs.readFileSync(EXPENSE_FILE, 'utf8'));
    return { claims: Array.isArray(raw.claims) ? raw.claims : [] };
  } catch {
    return { claims: [] };
  }
}

function writeData(data) {
  const dir = path.dirname(EXPENSE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(EXPENSE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function nextClaimId(claims) {
  const max = claims.reduce((m, c) => {
    const n = parseInt(String(c.id || '').replace('exp_', ''), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `exp_${max + 1}`;
}

function cleanText(value) {
  return String(value || '').trim();
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeItem(item = {}, index = 0) {
  const quantity = Math.max(toNumber(item.quantity, 1), 0);
  const taxIncludedUnitPrice = Math.max(toNumber(item.taxIncludedUnitPrice, item.amount), 0);
  const taxRate = toNumber(item.taxRate, 0.05);
  const divisor = taxRate >= 0 ? (1 + taxRate) : 1;
  const untaxedUnitPrice = roundMoney(taxIncludedUnitPrice / divisor);
  const untaxedTotal = roundMoney(quantity * untaxedUnitPrice);
  const taxAmount = roundMoney(quantity * taxIncludedUnitPrice - untaxedTotal);

  return {
    id: cleanText(item.id) || `item_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
    invoiceDate: item.invoiceDate || null,
    invoiceNo: cleanText(item.invoiceNo),
    summary: cleanText(item.summary),
    quantity,
    taxIncludedUnitPrice: roundMoney(taxIncludedUnitPrice),
    taxRate,
    untaxedUnitPrice,
    untaxedTotal,
    taxAmount,
    total: roundMoney(quantity * taxIncludedUnitPrice),
  };
}

function normalizeItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => normalizeItem(item, index))
    .filter(item => item.summary || item.invoiceNo || item.taxIncludedUnitPrice > 0);
}

function computeTotals(items) {
  return {
    itemCount: items.length,
    untaxedTotal: roundMoney(items.reduce((sum, item) => sum + item.untaxedTotal, 0)),
    taxTotal: roundMoney(items.reduce((sum, item) => sum + item.taxAmount, 0)),
    total: roundMoney(items.reduce((sum, item) => sum + item.total, 0)),
  };
}

function normalizePayment(input = {}) {
  const method = PAYMENT_METHODS.includes(input.paymentMethod) ? input.paymentMethod : '匯款';
  return {
    isMonthly: Boolean(input.isMonthly),
    expectedPaymentDate: input.expectedPaymentDate || null,
    paymentMethod: method,
    checkTitle: cleanText(input.checkTitle),
    checkDueDate: input.checkDueDate || null,
    bankName: cleanText(input.bankName),
    branchName: cleanText(input.branchName),
    accountName: cleanText(input.accountName),
    accountNumber: cleanText(input.accountNumber),
    otherPaymentNote: cleanText(input.otherPaymentNote),
  };
}

function normalizeClaimInput(input = {}, existing = {}) {
  const items = normalizeItems(input.items !== undefined ? input.items : existing.items);
  if (!items.length) throw new Error('至少需要一筆費用明細');

  const payment = normalizePayment({ ...existing.payment, ...input.payment });
  return {
    companyId: cleanText(input.companyId !== undefined ? input.companyId : existing.companyId),
    department: cleanText(input.department !== undefined ? input.department : existing.department),
    payee: cleanText(input.payee !== undefined ? input.payee : existing.payee),
    requestDate: input.requestDate || existing.requestDate || new Date().toISOString().slice(0, 10),
    payment,
    items,
    totals: computeTotals(items),
    notes: cleanText(input.notes !== undefined ? input.notes : existing.notes),
  };
}

function addHistory(claim, action, user, comment) {
  if (!claim.history) claim.history = [];
  claim.history.push({
    action,
    comment: cleanText(comment),
    userId: user?.id || null,
    userName: user?.displayName || user?.username || null,
    at: nowIso(),
  });
}

const expenseStore = {
  STATUSES,
  PAYMENT_METHODS,

  getRawData() {
    return readData();
  },

  setRawData(data) {
    writeData({ claims: Array.isArray(data?.claims) ? data.claims : [] });
  },

  list(filters = {}) {
    let { claims } = readData();
    if (filters.companyId) claims = claims.filter(c => c.companyId === filters.companyId);
    if (filters.status) claims = claims.filter(c => c.status === filters.status);
    if (filters.applicantId) claims = claims.filter(c => c.applicantId === filters.applicantId);
    if (filters.applicantNames?.length) {
      const names = new Set(filters.applicantNames);
      claims = claims.filter(c => names.has(c.applicantName) || names.has(c.salesperson));
    }
    if (filters.readyForFinance) claims = claims.filter(c => ['manager_approved', 'finance_approved'].includes(c.status));
    return claims.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  },

  getById(id) {
    return readData().claims.find(c => c.id === id) || null;
  },

  create(input, user) {
    const data = readData();
    const normalized = normalizeClaimInput(input);
    if (!normalized.companyId) throw new Error('公司為必填');
    if (!normalized.department) throw new Error('申請部門為必填');
    if (!normalized.payee) throw new Error('付款對象為必填');

    const now = nowIso();
    const applicantName = user?.displayName || user?.username || cleanText(input.applicantName);
    const claim = {
      id: nextClaimId(data.claims),
      ...normalized,
      applicantId: user?.id || null,
      applicantName,
      salesperson: applicantName,
      status: 'draft',
      attachments: [],
      history: [],
      createdAt: now,
      updatedAt: now,
      createdBy: user?.id || null,
    };
    addHistory(claim, 'created', user, input.comment);
    data.claims.push(claim);
    writeData(data);
    return claim;
  },

  update(id, input, user) {
    const data = readData();
    const idx = data.claims.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Expense claim not found');
    const claim = data.claims[idx];
    const normalized = normalizeClaimInput(input, claim);
    Object.assign(claim, normalized, { updatedAt: nowIso() });
    addHistory(claim, 'updated', user, input.comment);
    writeData(data);
    return claim;
  },

  transition(id, action, user, comment) {
    const data = readData();
    const idx = data.claims.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Expense claim not found');
    const claim = data.claims[idx];
    const now = nowIso();

    if (action === 'submit') {
      if (!['draft', 'rejected'].includes(claim.status)) throw new Error('只有草稿或退回單可送出');
      claim.status = 'submitted';
      claim.submittedAt = now;
      claim.submittedBy = user?.id || null;
    } else if (action === 'manager_approve') {
      if (claim.status !== 'submitted') throw new Error('只有待主管簽核的單據可核准');
      claim.status = 'manager_approved';
      claim.managerApprovedAt = now;
      claim.managerApprovedBy = user?.displayName || user?.username || null;
    } else if (action === 'finance_approve') {
      if (claim.status !== 'manager_approved') throw new Error('只有主管已核准的單據可財務核准');
      claim.status = 'finance_approved';
      claim.financeApprovedAt = now;
      claim.financeApprovedBy = user?.displayName || user?.username || null;
    } else if (action === 'paid') {
      if (!['manager_approved', 'finance_approved'].includes(claim.status)) throw new Error('只有財務待處理或已核准的單據可標記付款');
      claim.status = 'paid';
      claim.paidAt = now;
      claim.paidBy = user?.displayName || user?.username || null;
    } else if (action === 'reject') {
      if (!['submitted', 'manager_approved', 'finance_approved'].includes(claim.status)) throw new Error('此狀態不可退回');
      claim.status = 'rejected';
      claim.rejectedAt = now;
      claim.rejectedBy = user?.displayName || user?.username || null;
      claim.rejectionReason = cleanText(comment);
    } else {
      throw new Error('Unknown transition');
    }

    claim.updatedAt = now;
    addHistory(claim, action, user, comment);
    writeData(data);
    return claim;
  },

  delete(id) {
    const data = readData();
    const idx = data.claims.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('Expense claim not found');
    data.claims.splice(idx, 1);
    writeData(data);
  },

  addAttachment(id, attachment, user) {
    const data = readData();
    const claim = data.claims.find(c => c.id === id);
    if (!claim) throw new Error('Expense claim not found');
    if (!attachment?.dataUrl) throw new Error('Missing attachment data');
    if (String(attachment.dataUrl).length > 8 * 1024 * 1024) throw new Error('附件大小不可超過 8MB');
    if (!claim.attachments) claim.attachments = [];
    if (claim.attachments.length >= 12) throw new Error('每張費用單最多 12 個附件');

    const item = {
      id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      fileName: cleanText(attachment.fileName) || 'attachment',
      mimeType: cleanText(attachment.mimeType) || 'application/octet-stream',
      size: toNumber(attachment.size, null),
      dataUrl: attachment.dataUrl,
      uploadedAt: nowIso(),
      uploadedBy: user?.displayName || user?.username || null,
    };
    claim.attachments.push(item);
    claim.updatedAt = nowIso();
    addHistory(claim, 'attachment_added', user, item.fileName);
    writeData(data);
    return item;
  },

  deleteAttachment(id, attachmentId, user) {
    const data = readData();
    const claim = data.claims.find(c => c.id === id);
    if (!claim?.attachments) throw new Error('Attachment not found');
    const idx = claim.attachments.findIndex(a => a.id === attachmentId);
    if (idx === -1) throw new Error('Attachment not found');
    const [removed] = claim.attachments.splice(idx, 1);
    claim.updatedAt = nowIso();
    addHistory(claim, 'attachment_deleted', user, removed.fileName);
    writeData(data);
  },

  summary(claims) {
    const source = Array.isArray(claims) ? claims : readData().claims;
    return {
      totalClaims: source.length,
      totalAmount: roundMoney(source.reduce((sum, c) => sum + (c.totals?.total || 0), 0)),
      submitted: source.filter(c => c.status === 'submitted').length,
      managerApproved: source.filter(c => c.status === 'manager_approved').length,
      financeApproved: source.filter(c => c.status === 'finance_approved').length,
      paid: source.filter(c => c.status === 'paid').length,
      rejected: source.filter(c => c.status === 'rejected').length,
    };
  },
};

module.exports = expenseStore;
