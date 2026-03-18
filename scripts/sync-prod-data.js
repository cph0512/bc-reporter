#!/usr/bin/env node
/**
 * sync-prod-data.js
 * Fetches users AND pipeline data from production using token-based auth.
 * No session/login needed — uses SYNC_SECRET header.
 *
 * Usage: node scripts/sync-prod-data.js
 *
 * Env vars (optional):
 *   PROD_URL      — production base URL (default: https://reports.velopulse.io)
 *   SYNC_SECRET   — sync secret (default: bc-sync-default-key)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PROD_URL = process.env.PROD_URL || 'https://reports.velopulse.io';
const SYNC_SECRET = process.env.SYNC_SECRET || 'bc-sync-default-key';
const USERS_FILE = path.join(__dirname, '..', 'config', 'users.json');
const PIPELINE_FILE = path.join(__dirname, '..', 'config', 'pipeline.json');
const CONTACTS_FILE = path.join(__dirname, '..', 'config', 'contacts.json');

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

const BACKUP_DIR = path.join(__dirname, '..', 'config', 'backups');

function createBackup() {
  // Backup current local config files before overwriting
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const files = ['users.json', 'pipeline.json', 'contacts.json'];
  let backed = 0;
  for (const f of files) {
    const src = path.join(__dirname, '..', 'config', f);
    if (fs.existsSync(src)) {
      const dest = path.join(BACKUP_DIR, `${ts}_${f}`);
      fs.copyFileSync(src, dest);
      backed++;
    }
  }
  console.log(`💾 Backup created: ${ts} (${backed} files) → config/backups/`);
  // Keep only last 10 backups per file type
  for (const f of files) {
    const pattern = new RegExp(`_${f.replace('.', '\\.')}$`);
    const existing = fs.readdirSync(BACKUP_DIR).filter(name => pattern.test(name)).sort();
    while (existing.length > 10) {
      fs.unlinkSync(path.join(BACKUP_DIR, existing.shift()));
    }
  }
  return ts;
}

async function main() {
  console.log(`📥 Syncing from ${PROD_URL}...`);

  // Step 1: Backup current local data
  createBackup();

  // Step 2: Fetch latest production data
  const res = await request(`${PROD_URL}/api/sync/export`, {
    method: 'GET',
    headers: { 'x-sync-secret': SYNC_SECRET },
  });

  if (res.status !== 200) {
    console.error('❌ Export failed:', res.body);
    process.exit(1);
  }

  const data = JSON.parse(res.body);

  // Step 3: Save to config/
  fs.writeFileSync(USERS_FILE, JSON.stringify(data.users, null, 2), 'utf8');
  console.log(`✅ ${data.users.length} user(s): ${data.users.map(u => u.username).join(', ')}`);

  fs.writeFileSync(PIPELINE_FILE, JSON.stringify(data.pipeline, null, 2), 'utf8');
  console.log(`✅ ${data.pipeline.leads?.length || 0} leads, ${data.pipeline.activities?.length || 0} activities`);

  if (data.contacts) {
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(data.contacts, null, 2), 'utf8');
    console.log(`✅ ${data.contacts.contacts?.length || 0} contacts, ${data.contacts.categories?.length || 0} categories`);
  }

  console.log('\n🎉 Production data synced to config/');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
