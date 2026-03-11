#!/usr/bin/env node
/**
 * sync-prod-users.js
 * Fetches the current users from production and saves to config/users.json
 * so that the next Vercel deployment won't lose newly created accounts.
 *
 * Usage: node scripts/sync-prod-users.js
 *
 * Env vars (optional):
 *   PROD_URL      — production base URL (default: https://bc-reporter.vercel.app)
 *   ADMIN_USER    — admin username (default: admin@bbtruck.cc)
 *   ADMIN_PASS    — admin password (will prompt if not set)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');

const PROD_URL = process.env.PROD_URL || 'https://bc-reporter.vercel.app';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const USERS_FILE = path.join(__dirname, '..', 'config', 'users.json');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise(resolve => {
    rl.question(question, ans => { rl.close(); resolve(ans); });
  });
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main() {
  const adminPass = process.env.ADMIN_PASS || await ask('Admin password: ');

  // 1. Login
  console.log(`🔑 Logging in to ${PROD_URL}...`);
  const loginRes = await request(`${PROD_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: adminPass }),
  });

  if (loginRes.status !== 200) {
    console.error('❌ Login failed:', loginRes.body);
    process.exit(1);
  }

  // Extract session cookie
  const setCookies = loginRes.headers['set-cookie'];
  if (!setCookies) {
    console.error('❌ No session cookie returned');
    process.exit(1);
  }
  const cookie = setCookies.map(c => c.split(';')[0]).join('; ');

  // 2. Fetch users export
  console.log('📥 Fetching users from production...');
  const exportRes = await request(`${PROD_URL}/api/admin/users-export`, {
    method: 'GET',
    headers: { Cookie: cookie },
  });

  if (exportRes.status !== 200) {
    console.error('❌ Export failed:', exportRes.body);
    process.exit(1);
  }

  const users = JSON.parse(exportRes.body);
  console.log(`   Found ${users.length} user(s): ${users.map(u => u.username).join(', ')}`);

  // 3. Save to config/users.json
  const existing = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) : [];
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  console.log(`✅ Saved ${users.length} users to config/users.json (was ${existing.length})`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
