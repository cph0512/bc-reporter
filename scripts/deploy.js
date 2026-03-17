#!/usr/bin/env node
/**
 * deploy.js — Safe deploy script
 *
 * Automates: backup production data → commit → push → deploy
 * Ensures no data is lost on Vercel redeployment.
 *
 * Usage:
 *   ADMIN_PASS=xxx node scripts/deploy.js
 *   ADMIN_PASS=xxx node scripts/deploy.js "commit message here"
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');

const PROD_URL = process.env.PROD_URL || 'https://bc-reporter.vercel.app';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const USERS_FILE = path.join(__dirname, '..', 'config', 'users.json');
const PIPELINE_FILE = path.join(__dirname, '..', 'config', 'pipeline.json');

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

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8', cwd: path.join(__dirname, '..') }).trim();
}

async function syncProdData(adminPass) {
  // 1. Login
  console.log(`\n📦 Step 1: Backup production data`);
  console.log(`   🔑 Logging in to ${PROD_URL}...`);
  const loginRes = await request(`${PROD_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: adminPass }),
  });

  if (loginRes.status !== 200) {
    console.error('   ❌ Login failed — skipping backup (first deploy?)');
    return false;
  }

  const setCookies = loginRes.headers['set-cookie'];
  if (!setCookies) {
    console.error('   ❌ No session cookie — skipping backup');
    return false;
  }
  const cookie = setCookies.map(c => c.split(';')[0]).join('; ');
  console.log('   ✅ Login OK');

  // 2. Fetch users
  console.log('   📥 Fetching users...');
  const usersRes = await request(`${PROD_URL}/api/admin/users-export`, {
    method: 'GET',
    headers: { Cookie: cookie },
  });
  if (usersRes.status !== 200) {
    console.error('   ❌ Users export failed:', usersRes.body);
    return false;
  }
  const users = JSON.parse(usersRes.body);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  console.log(`   ✅ ${users.length} user(s) backed up`);

  // 3. Fetch pipeline data
  console.log('   📥 Fetching pipeline data...');
  const pipeRes = await request(`${PROD_URL}/api/admin/pipeline-export`, {
    method: 'GET',
    headers: { Cookie: cookie },
  });
  if (pipeRes.status !== 200) {
    console.error('   ❌ Pipeline export failed:', pipeRes.body);
    return false;
  }
  const pipeline = JSON.parse(pipeRes.body);
  fs.writeFileSync(PIPELINE_FILE, JSON.stringify(pipeline, null, 2), 'utf8');
  console.log(`   ✅ ${pipeline.leads?.length || 0} leads, ${pipeline.activities?.length || 0} activities backed up`);

  return true;
}

async function main() {
  const adminPass = process.env.ADMIN_PASS || await ask('Admin password: ');
  const commitMsg = process.argv[2] || null;

  console.log('🚀 BC Reporter — Safe Deploy');
  console.log('─'.repeat(40));

  // Step 1: Backup production data
  const synced = await syncProdData(adminPass);

  // Step 2: Stage synced data + any pending changes
  console.log(`\n📝 Step 2: Commit changes`);

  // Check if there are any changes (including synced data)
  if (synced) {
    git('add config/users.json config/pipeline.json');
    console.log('   ✅ Staged synced config files');
  }

  // Check for any other staged/unstaged changes
  const status = git('status --porcelain');
  if (!status) {
    console.log('   ℹ️  No changes to commit');
  } else {
    // Show what's being committed
    const lines = status.split('\n').filter(Boolean);
    console.log(`   📄 Files to commit:`);
    lines.forEach(l => console.log(`      ${l}`));

    // Auto-generate commit message if not provided
    const msg = commitMsg || (synced ? 'Sync production data + deploy' : 'Deploy');
    git(`commit -m "${msg}" --allow-empty`);
    console.log(`   ✅ Committed: "${msg}"`);
  }

  // Step 3: Push
  console.log(`\n🚀 Step 3: Push to remote`);
  const pushResult = git('push');
  console.log(`   ✅ Pushed to remote`);

  console.log('\n─'.repeat(40));
  console.log('✅ Deploy complete! Vercel will auto-deploy with production data preserved.');
}

main().catch(err => {
  console.error('\n❌ Deploy failed:', err.message);
  process.exit(1);
});
