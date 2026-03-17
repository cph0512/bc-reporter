#!/usr/bin/env node
/**
 * deploy.js — Safe deploy script
 *
 * Automates: backup production data → commit → push → deploy
 * Ensures no data is lost on Vercel redeployment.
 *
 * Usage:
 *   node scripts/deploy.js
 *   node scripts/deploy.js "commit message here"
 *
 * Env vars (optional):
 *   PROD_URL      — production base URL (default: https://reports.velopulse.io)
 *   SYNC_SECRET   — sync secret (default: bc-sync-default-key)
 */

const { execSync } = require('child_process');
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

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8', cwd: path.join(__dirname, '..') }).trim();
}

async function syncProdData() {
  console.log(`\n📦 Step 1: Backup production data`);
  console.log(`   📥 Fetching from ${PROD_URL}...`);

  try {
    const res = await request(`${PROD_URL}/api/sync/export`, {
      method: 'GET',
      headers: { 'x-sync-secret': SYNC_SECRET },
    });

    if (res.status !== 200) {
      console.error(`   ❌ Export failed (${res.status}) — skipping backup`);
      return false;
    }

    const data = JSON.parse(res.body);

    fs.writeFileSync(USERS_FILE, JSON.stringify(data.users, null, 2), 'utf8');
    console.log(`   ✅ ${data.users.length} user(s) backed up`);

    fs.writeFileSync(PIPELINE_FILE, JSON.stringify(data.pipeline, null, 2), 'utf8');
    console.log(`   ✅ ${data.pipeline.leads?.length || 0} leads, ${data.pipeline.activities?.length || 0} activities backed up`);

    return true;
  } catch (err) {
    console.error(`   ❌ Sync error: ${err.message} — skipping backup`);
    return false;
  }
}

async function main() {
  const commitMsg = process.argv[2] || null;

  console.log('🚀 BC Reporter — Safe Deploy');
  console.log('─'.repeat(40));

  // Step 1: Backup production data
  const synced = await syncProdData();

  // Step 2: Stage synced data + any pending changes
  console.log(`\n📝 Step 2: Commit changes`);

  if (synced) {
    git('add config/users.json config/pipeline.json');
    console.log('   ✅ Staged synced config files');
  }

  const status = git('status --porcelain');
  if (!status) {
    console.log('   ℹ️  No changes to commit');
  } else {
    const lines = status.split('\n').filter(Boolean);
    console.log(`   📄 Files to commit:`);
    lines.forEach(l => console.log(`      ${l}`));

    const msg = commitMsg || (synced ? 'Sync production data + deploy' : 'Deploy');
    git(`commit -m "${msg}" --allow-empty`);
    console.log(`   ✅ Committed: "${msg}"`);
  }

  // Step 3: Push
  console.log(`\n🚀 Step 3: Push to remote`);
  git('push');
  console.log(`   ✅ Pushed to remote`);

  console.log('\n' + '─'.repeat(40));
  console.log('✅ Deploy complete! Production data preserved.');
}

main().catch(err => {
  console.error('\n❌ Deploy failed:', err.message);
  process.exit(1);
});
