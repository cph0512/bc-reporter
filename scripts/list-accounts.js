require('dotenv').config();
const BCClient = require('../src/services/bcClient');
const bc = new BCClient(process.env);

(async () => {
  const accounts = await bc.getAccounts();

  const categories = {};
  accounts.forEach(a => {
    const cat = a.category || 'Unknown';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push({ number: a.number, name: a.displayName, sub: a.subCategory || '' });
  });

  for (const [cat, accs] of Object.entries(categories)) {
    console.log('\n=== ' + cat + ' ===');
    accs.sort((a, b) => a.number.localeCompare(b.number));
    accs.forEach(a => console.log('  ' + a.number + ' — ' + a.name + (a.sub ? ' [' + a.sub + ']' : '')));
  }
})();
