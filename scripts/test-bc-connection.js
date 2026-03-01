// scripts/test-bc-connection.js
// 測試 BC API 連線是否正常

require('dotenv').config();
const BCClient = require('../src/services/bcClient');

async function main() {
  console.log('🔄 Testing Business Central API connection...\n');

  const bc = new BCClient({
    BC_TENANT_ID: process.env.BC_TENANT_ID,
    BC_CLIENT_ID: process.env.BC_CLIENT_ID,
    BC_CLIENT_SECRET: process.env.BC_CLIENT_SECRET,
    BC_ENVIRONMENT: process.env.BC_ENVIRONMENT,
    BC_COMPANY_ID: process.env.BC_COMPANY_ID,
  });

  // Step 1: Test authentication
  console.log('1️⃣  Acquiring OAuth token...');
  try {
    await bc.getToken();
    console.log('   ✅ Token acquired successfully\n');
  } catch (error) {
    console.error('   ❌ Authentication failed:', error.message);
    console.error('\n📋 Checklist:');
    console.error('   - BC_TENANT_ID 是否正確？');
    console.error('   - BC_CLIENT_ID 是否正確？');
    console.error('   - BC_CLIENT_SECRET 是否過期？');
    console.error('   - Azure AD App 是否已設定 Dynamics 365 Business Central API 權限？');
    console.error('   - 是否已在 BC 的 Azure AD Applications 頁面註冊此 App？');
    process.exit(1);
  }

  // Step 2: Test Income Statement API
  console.log('2️⃣  Fetching Income Statement...');
  try {
    const { filter } = BCClient.getMonthRange(2025, 1);
    const is = await bc.getIncomeStatement(filter);
    console.log(`   ✅ Got ${is.length} rows`);
    if (is.length > 0) {
      console.log('   Sample row:', JSON.stringify(is[0], null, 2));
    }
    console.log();
  } catch (error) {
    console.error('   ⚠️  Income Statement failed:', error.message);
    console.log();
  }

  // Step 3: Test Balance Sheet API
  console.log('3️⃣  Fetching Balance Sheet...');
  try {
    const bs = await bc.getBalanceSheet(BCClient.getEndOfMonth(2025, 1));
    console.log(`   ✅ Got ${bs.length} rows`);
    if (bs.length > 0) {
      console.log('   Sample row:', JSON.stringify(bs[0], null, 2));
    }
    console.log();
  } catch (error) {
    console.error('   ⚠️  Balance Sheet failed:', error.message);
    console.log();
  }

  // Step 4: Test GL Entries
  console.log('4️⃣  Fetching General Ledger Entries...');
  try {
    const gl = await bc.getGeneralLedgerEntries('2025-01-01', '2025-01-31', { top: 5 });
    console.log(`   ✅ Got ${gl.length} entries`);
    if (gl.length > 0) {
      console.log('   Sample entry:', JSON.stringify(gl[0], null, 2));
    }
    console.log();
  } catch (error) {
    console.error('   ⚠️  GL Entries failed:', error.message);
    console.log();
  }

  // Step 5: Test Chart of Accounts
  console.log('5️⃣  Fetching Chart of Accounts...');
  try {
    const accounts = await bc.getAccounts();
    console.log(`   ✅ Got ${accounts.length} accounts`);
    if (accounts.length > 0) {
      console.log('\n   📊 Account categories found:');
      const categories = {};
      accounts.forEach(a => {
        const cat = a.category || 'Unknown';
        categories[cat] = (categories[cat] || 0) + 1;
      });
      Object.entries(categories).forEach(([cat, count]) => {
        console.log(`      ${cat}: ${count} accounts`);
      });
      console.log('\n   📝 First 10 accounts:');
      accounts.slice(0, 10).forEach(a => {
        console.log(`      ${a.number} — ${a.displayName} [${a.category}/${a.subCategory || ''}]`);
      });
    }
    console.log();
  } catch (error) {
    console.error('   ⚠️  Accounts failed:', error.message);
    console.log();
  }

  console.log('✅ Connection test complete!');
  console.log('\n💡 下一步：');
  console.log('   1. 根據上面的 Chart of Accounts 調整 config/accounts-mapping.json');
  console.log('   2. 執行 npm start 啟動伺服器');
  console.log('   3. 打開 Web Dashboard 查看報表');
}

main().catch(console.error);
