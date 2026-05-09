// src/services/userStore.js
// JSON-file backed user store with bcrypt password hashing

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { resolveDataFile } = require('./dataDir');

const USERS_FILE = resolveDataFile('users.json');
const COST = 10;

function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch { return []; }
}

function writeUsers(users) {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function nextId(users) {
  const max = users.reduce((m, u) => {
    const n = parseInt(u.id.replace('u_', ''), 10);
    return n > m ? n : m;
  }, 0);
  return `u_${max + 1}`;
}

const userStore = {
  getAll() {
    return readUsers().map(({ passwordHash, ...rest }) => rest);
  },

  getAllRaw() {
    return readUsers();
  },

  findById(id) {
    return readUsers().find(u => u.id === id) || null;
  },

  findByUsername(username) {
    return readUsers().find(u => u.username === username) || null;
  },

  async verifyPassword(username, password) {
    const user = this.findByUsername(username);
    if (!user) return null;
    if (user.disabled) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;
    const { passwordHash, ...safe } = user;
    return safe;
  },

  async create({ username, password, role = 'user', displayName = '', department = '', companies = [], dashboards = [], managedSalespeople = [], canExport, isSales, strategyRole }) {
    const users = readUsers();
    if (users.find(u => u.username === username)) {
      throw new Error('Username already exists');
    }
    const passwordHash = await bcrypt.hash(password, COST);
    // Default canExport: admin/manager → true, user → false
    const exportAllowed = canExport !== undefined ? Boolean(canExport) : (role === 'admin' || role === 'manager');
    const newUser = {
      id: nextId(users),
      username,
      passwordHash,
      role,
      displayName: displayName || username,
      department: String(department || '').trim(),
      companies,
      dashboards,
      managedSalespeople,
      canExport: exportAllowed,
      isSales: Boolean(isSales),
      strategyRole: strategyRole || 'viewer', // finance_editor | sales_manager | viewer
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    writeUsers(users);
    const { passwordHash: _, ...safe } = newUser;
    return safe;
  },

  async update(id, fields) {
    const users = readUsers();
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) throw new Error('User not found');

    if (fields.username && fields.username !== users[idx].username) {
      if (users.find(u => u.username === fields.username)) {
        throw new Error('Username already exists');
      }
      users[idx].username = fields.username;
    }
    if (fields.displayName !== undefined) users[idx].displayName = fields.displayName;
    if (fields.department !== undefined) users[idx].department = String(fields.department || '').trim();
    if (fields.role) users[idx].role = fields.role;
    if (fields.companies !== undefined) users[idx].companies = fields.companies;
    if (fields.dashboards !== undefined) users[idx].dashboards = fields.dashboards;
    if (fields.managedSalespeople !== undefined) users[idx].managedSalespeople = fields.managedSalespeople;
    if (fields.canExport !== undefined) users[idx].canExport = Boolean(fields.canExport);
    if (fields.disabled !== undefined) users[idx].disabled = fields.disabled;
    if (fields.isSales !== undefined) users[idx].isSales = Boolean(fields.isSales);
    if (fields.strategyRole !== undefined) users[idx].strategyRole = fields.strategyRole;
    if (fields.password) {
      users[idx].passwordHash = await bcrypt.hash(fields.password, COST);
    }
    writeUsers(users);
    const { passwordHash, ...safe } = users[idx];
    return safe;
  },

  delete(id) {
    const users = readUsers();
    const target = users.find(u => u.id === id);
    if (!target) throw new Error('User not found');
    const admins = users.filter(u => u.role === 'admin');
    if (target.role === 'admin' && admins.length <= 1) {
      throw new Error('Cannot delete the last admin');
    }
    writeUsers(users.filter(u => u.id !== id));
  },

  async ensureDefaultAdmin() {
    const users = readUsers();
    if (users.length > 0) return;
    const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!bootstrapPassword) {
      console.warn('⚠️  No users found and ADMIN_BOOTSTRAP_PASSWORD is not set — skipping admin creation');
      console.warn('   Set ADMIN_BOOTSTRAP_PASSWORD env var to bootstrap an admin account on first run');
      return;
    }
    console.log('⚠️  No users found — creating admin account from ADMIN_BOOTSTRAP_PASSWORD');
    await this.create({
      username: 'admin',
      password: bootstrapPassword,
      role: 'admin',
      displayName: 'Administrator',
    });
    console.log('   Admin account created. Change the password after first login.');
  },
};

module.exports = userStore;
