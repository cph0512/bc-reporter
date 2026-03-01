// src/middleware/companyAccess.js
// Validates companyId query param and checks user access

const companyStore = require('../services/companyStore');

function companyAccess(req, res, next) {
  const companyId = req.query.companyId;
  if (!companyId) {
    return res.status(400).json({ error: 'companyId query parameter required' });
  }

  const company = companyStore.findById(companyId);
  if (!company) {
    return res.status(404).json({ error: 'Company not found' });
  }

  // Check user has access to this company
  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Empty companies array = access all
  if (user.companies && user.companies.length > 0 && !user.companies.includes(companyId)) {
    return res.status(403).json({ error: 'No access to this company' });
  }

  req.company = company;
  next();
}

module.exports = companyAccess;
