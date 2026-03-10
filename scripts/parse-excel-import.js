#!/usr/bin/env node
/**
 * Parse BBT業務進度表.xlsx and extract all weekly tab data
 * for importing into the pipeline system.
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const filePath = path.join('/Users/cph/Downloads', 'BBT業務進度表.xlsx');
const wb = XLSX.readFile(filePath);

console.log('=== All Sheet Names ===');
console.log(wb.SheetNames.join('\n'));
console.log('');

// Convert sheet name "1141021" to "114/10/21" format
function toWeekLabel(sheetName) {
  if (/^\d{7}$/.test(sheetName)) {
    const y = sheetName.substring(0, 3);
    const m = sheetName.substring(3, 5);
    const d = sheetName.substring(5, 7);
    return `${y}/${m}/${d}`;
  }
  return sheetName;
}

// Filter only weekly tabs (format: NNNNNNN like 1141021)
const weeklySheets = wb.SheetNames.filter(n => /^\d{7}$/.test(n));
console.log(`Found ${weeklySheets.length} weekly sheets:`, weeklySheets.map(toWeekLabel));
console.log('');

// Master data structures
const leadsMap = {}; // key: "salesperson-companyName" => lead object
const allActivities = []; // { leadKey, weekLabel, status, notes, review }

// Skip these header-like values
const skipCompanyNames = new Set([
  'k', '業務進度表', 'Jerry週目標', 'Jeff週目標',
  '目前進度', '備註', 'Jerry週回顧', 'Jeff週回顧',
  '第 1 欄', '第1欄'
]);

for (const sheetName of weeklySheets) {
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const weekLabel = toWeekLabel(sheetName);

  console.log(`\n=== Sheet: ${weekLabel} (${data.length} rows) ===`);

  // Print first 2 rows to understand structure
  for (let r = 0; r < Math.min(2, data.length); r++) {
    console.log(`  Row ${r}:`, JSON.stringify(data[r]?.slice(0, 10)));
  }

  // Parse rows (skip header row 0)
  // Structure: A=Jerry company, B=Jerry status, C=Jerry notes, D=Jerry review
  //           E=Jeff company, F=Jeff status, G=Jeff notes, H=Jeff review
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    // Jerry side (columns A-D, index 0-3)
    const jerryCompany = String(row[0] || '').trim();
    const jerryStatus = String(row[1] || '').trim();
    const jerryNotes = String(row[2] || '').trim();
    const jerryReview = String(row[3] || '').trim();

    if (jerryCompany && !skipCompanyNames.has(jerryCompany)) {
      const key = `Jerry-${jerryCompany}`;
      if (!leadsMap[key]) {
        leadsMap[key] = {
          companyName: jerryCompany,
          salesperson: 'Jerry',
          statuses: [],
          category: '',
          firstNotes: jerryNotes,
          latestNotes: jerryNotes
        };
      }
      leadsMap[key].statuses.push({ week: weekLabel, status: jerryStatus });
      if (jerryNotes) leadsMap[key].latestNotes = jerryNotes;

      // Create activity for this week (with notes/status change and/or review)
      allActivities.push({
        leadKey: key,
        weekLabel,
        status: jerryStatus,
        notes: jerryNotes,
        review: jerryReview
      });
    }

    // Jeff side (columns E-H, index 4-7)
    const jeffCompany = String(row[4] || '').trim();
    const jeffStatus = String(row[5] || '').trim();
    const jeffNotes = String(row[6] || '').trim();
    const jeffReview = String(row[7] || '').trim();

    if (jeffCompany && !skipCompanyNames.has(jeffCompany)) {
      const key = `Jeff-${jeffCompany}`;
      if (!leadsMap[key]) {
        leadsMap[key] = {
          companyName: jeffCompany,
          salesperson: 'Jeff',
          statuses: [],
          category: '',
          firstNotes: jeffNotes,
          latestNotes: jeffNotes
        };
      }
      leadsMap[key].statuses.push({ week: weekLabel, status: jeffStatus });
      if (jeffNotes) leadsMap[key].latestNotes = jeffNotes;

      allActivities.push({
        leadKey: key,
        weekLabel,
        status: jeffStatus,
        notes: jeffNotes,
        review: jeffReview
      });
    }
  }
}

// Determine final status for each lead (last recorded status)
const leads = Object.entries(leadsMap).map(([key, lead]) => {
  const lastStatus = lead.statuses[lead.statuses.length - 1];
  // Map status text to our system statuses
  let status = '進行中'; // default
  const rawStatus = (lastStatus?.status || '');
  if (rawStatus.includes('初步接觸') || rawStatus.includes('未開始')) status = '初步接觸';
  else if (rawStatus.includes('報價')) status = '報價';
  else if (rawStatus.includes('已完成') || rawStatus.includes('結案')) status = '已完成';
  else if (rawStatus.includes('進行中')) status = '進行中';

  return {
    key,
    companyName: lead.companyName,
    salesperson: lead.salesperson,
    status,
    category: '客戶',
    notes: lead.latestNotes,
    statusHistory: lead.statuses
  };
});

console.log('\n\n========================================');
console.log('=== MASTER LEAD LIST ===');
console.log('========================================');
console.log(`Total unique leads: ${leads.length}`);
leads.forEach(l => {
  const hist = l.statusHistory.map(s => `${s.week}:${s.status}`).join(' → ');
  console.log(`  [${l.salesperson}] ${l.companyName} | Final: ${l.status} | History: ${hist}`);
});

console.log(`\n========================================`);
console.log(`=== ACTIVITIES SUMMARY ===`);
console.log(`========================================`);
console.log(`Total activity records: ${allActivities.length}`);

// Count activities per week
const weekCounts = {};
allActivities.forEach(a => {
  weekCounts[a.weekLabel] = (weekCounts[a.weekLabel] || 0) + 1;
});
Object.entries(weekCounts).forEach(([w, c]) => {
  console.log(`  ${w}: ${c} entries`);
});

// Save to JSON for import
const output = { leads, activities: allActivities };
const outPath = path.join(__dirname, '..', 'config', 'excel-import-data.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
console.log(`\nSaved import data to: ${outPath}`);
