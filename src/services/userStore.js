// src/services/userStore.js
// JSON-file backed user store with bcrypt password hashing

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const USERS_SRC = path.join(__dirname, '../../config/users.json');
const USERS_FILE = process.env.VERCEL ? '/tmp/users.json' : USERS_SRC;
const COST = 10;

// Vercel: copy bundled users.json to writable /tmp on cold start
if (process.env.VERCEL && !fs.existsSync(USERS_FILE) && fs.existsSync(USERS_SRC)) {
  fs.copyFileSync(USERS_SRC, USERS_FILE);
}

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

  findById(id) {
    return readUsers().find(u => u.id === id) || null;
  },

  findByUsername(username) {
    return readUsers().find(u => u.username === username) || null;
  },

  async verifyPassword(username, password) {
    const user = this.findByUsername(username);
    if (!user) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;
    const { passwordHash, ...safe } = user;
    return safe;
  },

  async create({ username, password, role = 'user', displayName = '', companies = [], dashboards = [] }) {
    const users = readUsers();
    if (users.find(u => u.username === username)) {
      throw new Error('Username already exists');
    }
    const passwordHash = await bcrypt.hash(password, COST);
    const newUser = {
      id: nextId(users),
      username,
      passwordHash,
      role,
      displayName: displayName || username,
      companies,
      dashboards,
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
    if (fields.role) users[idx].role = fields.role;
    if (fields.companies !== undefined) users[idx].companies = fields.companies;
    if (fields.dashboards !== undefined) users[idx].dashboards = fields.dashboards;
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
    console.log('⚠️  No users found — creating default admin account');
    await this.create({
      username: 'admin',
      password: 'admin123',
      role: 'admin',
      displayName: 'Administrator',
    });
    console.log('   Username: admin / Password: admin123 — CHANGE IMMEDIATELY');
  },
};

module.exports = userStore;
