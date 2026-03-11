#!/usr/bin/env node
/**
 * sync-prod-data.js
 * Fetches BOTH users AND pipeline data from production before pushing,
 * so that Vercel redeployment won't lose any data.
 *
 * Usage: node scripts/sync-prod-data.js
 *
 * Env vars (optional):
 *   PROD_URL      — production base URL (default: https://bc-reporter.vercel.app)
 *   ADMIN_USER    — admin username (default: admin)
 *   ADMIN_PASS    — admin password (will prompt if not set)
 */

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

async function main() {
  const adminPass = process.env.ADMIN_PASS || await ask('Admin password: ');

  // 1. Login
  console.log(`🔑 Logging in to ${PROD_URL}...`);
  const loginRes = await request(`${PROD_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: adminPass }),
  });

  if (loginRes.status !== 200) {
    console.error('❌ Login failed:', loginRes.body);
    process.exit(1);
  }

  const setCookies = loginRes.headers['set-cookie'];
  if (!setCookies) {
    console.error('❌ No session cookie returned');
    process.exit(1);
  }
  const cookie = setCookies.map(c => c.split(';')[0]).join('; ');
  console.log('✅ Login OK\n');

  // 2. Fetch users
  console.log('📥 Syncing users...');
  const usersRes = await request(`${PROD_URL}/api/admin/users-export`, {
    method: 'GET',
    headers: { Cookie: cookie },
  });
  if (usersRes.status !== 200) {
    console.error('❌ Users export failed:', usersRes.body);
    process.exit(1);
  }
  const users = JSON.parse(usersRes.body);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  console.log(`   ✅ ${users.length} user(s): ${users.map(u => u.username).join(', ')}`);

  // 3. Fetch pipeline data
  console.log('📥 Syncing pipeline data...');
  const pipeRes = await request(`${PROD_URL}/api/admin/pipeline-export`, {
    method: 'GET',
    headers: { Cookie: cookie },
  });
  if (pipeRes.status !== 200) {
    console.error('❌ Pipeline export failed:', pipeRes.body);
    process.exit(1);
  }
  const pipeline = JSON.parse(pipeRes.body);
  fs.writeFileSync(PIPELINE_FILE, JSON.stringify(pipeline, null, 2), 'utf8');
  console.log(`   ✅ ${pipeline.leads?.length || 0} leads, ${pipeline.activities?.length || 0} activities`);

  console.log('\n🎉 All production data synced to config/');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
