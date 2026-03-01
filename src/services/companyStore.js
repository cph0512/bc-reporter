// src/services/companyStore.js
// Reads config/companies.json, provides company lookup and user-access filtering

const fs = require('fs');
const path = require('path');

const COMPANIES_FILE = path.join(__dirname, '../../config/companies.json');

function readCompanies() {
  try {
    if (!fs.existsSync(COMPANIES_FILE)) return [];
    return JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf8'));
  } catch { return []; }
}

const companyStore = {
  getAll() {
    return readCompanies();
  },

  findById(id) {
    return readCompanies().find(c => c.id === id) || null;
  },

  /**
   * Returns companies the user can access.
   * - user.companies is empty array → all companies (admin default)
   * - user.companies has entries → only those
   */
  getForUser(user) {
    const all = readCompanies();
    if (!user.companies || user.companies.length === 0) return all;
    return all.filter(c => user.companies.includes(c.id));
  },
};

module.exports = companyStore;
