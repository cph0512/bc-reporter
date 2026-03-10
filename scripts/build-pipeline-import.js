#!/usr/bin/env node
/**
 * Build clean pipeline.json from parsed Excel data.
 * Handles: data cleaning, duplicate merging, category extraction, activity import.
 */
const fs = require('fs');
const path = require('path');

const rawData = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'config', 'excel-import-data.json'), 'utf8'
));

// ============================================================
// 1. DATA CLEANING - Filter out non-company entries
// ============================================================
const nonCompanyPatterns = [
  /^\d{1,2}\/\d{1,2}/, // starts with date like "11/5 祥億"
  /^系統/, // system tasks
  /^車隊計價/, /^倉庫$/, /^ECFIT倉庫/,
  /^過年前/, /^送禮/, /^約訪/,
  /合作溝通$/, // "路路通合作溝通" → keep 路路通 separately
];

function isNonCompany(name) {
  return nonCompanyPatterns.some(p => p.test(name));
}

// ============================================================
// 2. DUPLICATE MERGING - Map variant names to canonical names
// ============================================================
const nameMapping = {
  '普利司通高雄上線': '普利司通',
  '簽約一家倉儲客戶': null, // not a company
  '路路通合作溝通': '路路通',
  '11/5鴻達邀約餐敘': null,
  '11/6 慶豐富': null,
  '11/5 祥億': null,
  '11/7 新加坡商藍旅': null,
  '系統路線價格': null,
  'ECFIT倉庫': null,
  '車隊計價': null,
  '倉庫': null,
  '過年前都在送禮跟維繫，本周開始約訪新客戶': null,
  'uber': 'UBER',
  '和程運輸': '和程',
  '和程車隊': '和程',
  '聯鈞光電': '聯釣光電', // normalize
};

function canonicalize(name) {
  if (nameMapping.hasOwnProperty(name)) return nameMapping[name];
  if (isNonCompany(name)) return null;
  return name;
}

// ============================================================
// 3. CATEGORY EXTRACTION from notes
// ============================================================
const categoryKeywords = {
  '車隊+客戶': '車隊+客戶',
  '車隊': '車隊',
  '系統商+潛在合作對象': '系統商+潛在合作對象',
  '系統商': '系統商',
  '合作廠商': '合作廠商',
  '戰略合作夥伴': '戰略合作夥伴',
  '客戶': '客戶',
  '爭取合作': '客戶',
};

function extractCategory(notes) {
  if (!notes) return '客戶';
  for (const [keyword, cat] of Object.entries(categoryKeywords)) {
    if (notes.includes(keyword)) return cat;
  }
  return '客戶';
}

// ============================================================
// 4. PROCESS LEADS - merge and clean
// ============================================================
const mergedLeads = {}; // key: "salesperson-canonicalName"

for (const lead of rawData.leads) {
  const canonical = canonicalize(lead.companyName);
  if (!canonical) continue;

  const key = `${lead.salesperson}-${canonical}`;
  if (!mergedLeads[key]) {
    mergedLeads[key] = {
      companyName: canonical,
      salesperson: lead.salesperson,
      status: lead.status,
      category: extractCategory(lead.notes) || lead.category,
      notes: lead.notes,
      statusHistory: lead.statusHistory || []
    };
  } else {
    // Merge: combine status histories
    const existing = mergedLeads[key];
    existing.statusHistory = [...existing.statusHistory, ...(lead.statusHistory || [])];
    // Use latest status
    if (lead.statusHistory?.length) {
      const lastHist = lead.statusHistory[lead.statusHistory.length - 1];
      existing.status = mapStatus(lastHist.status);
    }
    // Update notes if newer has content
    if (lead.notes) existing.notes = lead.notes;
    // Update category if found
    const cat = extractCategory(lead.notes);
    if (cat !== '客戶') existing.category = cat;
  }
}

function mapStatus(raw) {
  if (!raw) return '進行中';
  if (raw.includes('初步接觸') || raw.includes('未開始')) return '初步接觸';
  if (raw.includes('報價')) return '報價';
  if (raw.includes('已完成') || raw.includes('結案')) return '已完成';
  if (raw.includes('終止')) return '已完成'; // treat as completed/closed
  return '進行中';
}

// ============================================================
// 5. BUILD PIPELINE JSON
// ============================================================
let nextId = 1;
const leads = [];
const leadIdMap = {}; // key -> id mapping

for (const [key, lead] of Object.entries(mergedLeads)) {
  const id = `lead_${nextId++}`;
  leadIdMap[key] = id;

  // Sort status history by week
  const sortedHistory = (lead.statusHistory || []).sort((a, b) => a.week.localeCompare(b.week));

  leads.push({
    id,
    companyName: lead.companyName,
    salesperson: lead.salesperson,
    status: lead.status,
    category: lead.category,
    notes: lead.notes || '',
    estimatedValue: null,
    createdAt: weekToISODate(sortedHistory[0]?.week || '115/03/10'),
    updatedAt: weekToISODate(sortedHistory[sortedHistory.length - 1]?.week || '115/03/10'),
    createdBy: lead.salesperson
  });
}

// ============================================================
// 6. BUILD ACTIVITIES - weekly reviews with status tracking
// ============================================================
let actNextId = 1;
const activities = [];
const seenActKeys = new Set(); // deduplicate

for (const act of rawData.activities) {
  const canonical = canonicalize(act.leadKey.split('-').slice(1).join('-'));
  if (!canonical) continue;

  const salesperson = act.leadKey.split('-')[0];
  const key = `${salesperson}-${canonical}`;
  const leadId = leadIdMap[key];
  if (!leadId) continue;

  // Build content: only include the weekly review text
  const content = (act.review || '').trim();
  if (!content) continue;

  // Deduplicate by leadId + weekLabel
  const actKey = `${leadId}-${act.weekLabel}`;
  if (seenActKeys.has(actKey)) continue;
  seenActKeys.add(actKey);

  activities.push({
    id: `act_${actNextId++}`,
    leadId,
    weekLabel: act.weekLabel,
    content,
    createdAt: weekToISODate(act.weekLabel),
    createdBy: salesperson
  });
}

function weekToISODate(weekLabel) {
  if (!weekLabel) return new Date().toISOString();
  // Convert "114/10/21" to ISO date
  // Taiwan year: 114 = 2025, 115 = 2026
  const parts = weekLabel.split('/');
  if (parts.length !== 3) return new Date().toISOString();
  const year = parseInt(parts[0]) + 1911;
  const month = parts[1].padStart(2, '0');
  const day = parts[2].padStart(2, '0');
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

// ============================================================
// 7. OUTPUT
// ============================================================
const pipeline = { leads, activities };

console.log('========================================');
console.log('PIPELINE IMPORT SUMMARY');
console.log('========================================');
console.log(`Total leads: ${leads.length}`);
console.log(`Total activities: ${activities.length}`);
console.log('');

// Status breakdown
const statusCounts = {};
leads.forEach(l => { statusCounts[l.status] = (statusCounts[l.status] || 0) + 1; });
console.log('Status breakdown:');
Object.entries(statusCounts).forEach(([s, c]) => console.log(`  ${s}: ${c}`));

// Salesperson breakdown
const spCounts = {};
leads.forEach(l => { spCounts[l.salesperson] = (spCounts[l.salesperson] || 0) + 1; });
console.log('\nSalesperson breakdown:');
Object.entries(spCounts).forEach(([s, c]) => console.log(`  ${s}: ${c}`));

// Category breakdown
const catCounts = {};
leads.forEach(l => { catCounts[l.category] = (catCounts[l.category] || 0) + 1; });
console.log('\nCategory breakdown:');
Object.entries(catCounts).forEach(([s, c]) => console.log(`  ${s}: ${c}`));

// Activities per week
const weekActCounts = {};
activities.forEach(a => { weekActCounts[a.weekLabel] = (weekActCounts[a.weekLabel] || 0) + 1; });
console.log('\nActivities per week:');
Object.entries(weekActCounts).sort((a, b) => a[0].localeCompare(b[0]))
  .forEach(([w, c]) => console.log(`  ${w}: ${c} entries`));

// Print all leads
console.log('\n========================================');
console.log('ALL LEADS:');
console.log('========================================');
leads.forEach(l => {
  console.log(`  #${l.id} [${l.salesperson}] ${l.companyName} | ${l.status} | ${l.category} | ${l.notes.substring(0, 50)}...`);
});

// Save
const outPath = path.join(__dirname, '..', 'config', 'pipeline.json');
fs.writeFileSync(outPath, JSON.stringify(pipeline, null, 2), 'utf8');
console.log(`\n✅ Saved to: ${outPath}`);
