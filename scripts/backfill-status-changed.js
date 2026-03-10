// Backfill statusChangedAt for existing leads
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../config/pipeline.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

let updated = 0;
data.leads.forEach(l => {
  if (!l.statusChangedAt) {
    l.statusChangedAt = l.updatedAt || l.createdAt;
    updated++;
  }
});

fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
console.log(`Backfilled statusChangedAt for ${updated} of ${data.leads.length} leads`);
