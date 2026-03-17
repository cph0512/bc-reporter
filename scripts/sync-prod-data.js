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

async function main() {
  console.log(`📥 Syncing from ${PROD_URL}...`);

  const res = await request(`${PROD_URL}/api/sync/export`, {
    method: 'GET',
    headers: { 'x-sync-secret': SYNC_SECRET },
  });

  if (res.status !== 200) {
    console.error('❌ Export failed:', res.body);
    process.exit(1);
  }

  const data = JSON.parse(res.body);

  // Save users
  fs.writeFileSync(USERS_FILE, JSON.stringify(data.users, null, 2), 'utf8');
  console.log(`✅ ${data.users.length} user(s): ${data.users.map(u => u.username).join(', ')}`);

  // Save pipeline
  fs.writeFileSync(PIPELINE_FILE, JSON.stringify(data.pipeline, null, 2), 'utf8');
  console.log(`✅ ${data.pipeline.leads?.length || 0} leads, ${data.pipeline.activities?.length || 0} activities`);

  console.log('\n🎉 Production data synced to config/');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
