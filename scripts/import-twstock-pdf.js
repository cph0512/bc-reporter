#!/usr/bin/env node
// scripts/import-twstock-pdf.js
//
// 一次匯入 QIC Semi Supply Chain 研究報告（2024 年 + 最新擴大版）所列的
// 132 家台灣半導體供應鏈企業到台股追蹤清單。
//
// 資料來源：QIC Research — Semi Supply Chain_(CN)_重點精華.pdf (p.6–8)
//   設備與零組件 75 家、廠區服務 16 家、材料服務 41 家；isCore=true 表示
//   在 QIC 2024 年初版 49 家核心名單內。
//
// 使用方式：
//   node scripts/import-twstock-pdf.js           # 實際寫入 config/tw-stock.json
//   node scripts/import-twstock-pdf.js --dry-run # 只列出不寫檔
//
// 已存在於 watchlist 的代碼只補 category / isCore，不覆蓋原本的 name / market / addedBy。
//
// 市場別 (sii / otc / rotc) 為人工依公開資料標註；若日後同步失敗多半是
// 市場別誤判，可於 UI 上刪除該股後重新加入正確市場別。

'use strict';

const twStockStore = require('../src/services/twStockStore');

// 2024 年初版 QIC 研究 49 家核心名單（皆包含於 132 家內，僅做為 isCore flag）
const CORE_49 = new Set([
  '8028', '1560', '6532', '6196', '6823', '2404', '5536', '6438', '2464',
  '6788', '3551', '4542', '3413', '4770', '6208', '1717', '2338', '3680',
  '6953', '7556', '3131', '3583', '3580', '3587', '6830', '3289', '4549',
  '4580', '3535', '3581', '8027', '6187', '2360', '6789', '3374', '5434',
  '3010', '8091', '1785', '1711', '1727', '4755', '5234', '1773', '1229',
  '6667', '2467', '6640', '5443',
]);

// category: 'equipment' | 'facility' | 'materials'
// market: 'sii' (上市) | 'otc' (上櫃) | 'rotc' (興櫃)
// 註記「?」開頭的 market 為較低信心的判定，sync 失敗時應優先檢查
const COMPANIES = [
  // === 設備與零組件 (75) ===
  { code: '3711', name: '日月光投控', category: 'equipment', market: 'sii' },
  { code: '2360', name: '致茂', category: 'equipment', market: 'sii' },
  { code: '7769', name: '鴻勁精密', category: 'equipment', market: 'rotc' },
  { code: '2449', name: '京元電子', category: 'equipment', market: 'sii' },
  { code: '3481', name: '群創', category: 'equipment', market: 'sii' },
  { code: '2409', name: '友達', category: 'equipment', market: 'sii' },
  { code: '2049', name: '上銀', category: 'equipment', market: 'sii' },
  { code: '6789', name: '采鈺', category: 'equipment', market: 'sii' },
  { code: '3374', name: '精材', category: 'equipment', market: 'otc' },
  { code: '3680', name: '家登', category: 'equipment', market: 'otc' },
  { code: '3450', name: '聯鈞', category: 'equipment', market: 'otc' },
  { code: '6257', name: '矽格', category: 'equipment', market: 'sii' },
  { code: '3131', name: '弘塑', category: 'equipment', market: 'otc' },
  { code: '6442', name: '光聖', category: 'equipment', market: 'sii' },
  { code: '3583', name: '辛耘', category: 'equipment', market: 'otc' },
  { code: '3413', name: '京鼎', category: 'equipment', market: 'otc' },
  { code: '3714', name: '富采', category: 'equipment', market: 'sii' },
  { code: '7734', name: '印能', category: 'equipment', market: 'rotc' },
  { code: '3363', name: '上銓', category: 'equipment', market: 'otc' },
  { code: '4979', name: '華星光', category: 'equipment', market: 'otc' },
  { code: '4977', name: '眾達', category: 'equipment', market: 'otc' },
  { code: '6451', name: '訊芯', category: 'equipment', market: 'sii' },
  { code: '4576', name: '大銀微', category: 'equipment', market: 'otc' },
  { code: '4770', name: '上品', category: 'equipment', market: 'otc' },
  { code: '2467', name: '志聖', category: 'equipment', market: 'sii' },
  { code: '6187', name: '萬潤', category: 'equipment', market: 'otc' },
  { code: '6640', name: '均華', category: 'equipment', market: 'sii' },
  { code: '6937', name: '天虹', category: 'equipment', market: 'otc' },
  { code: '2338', name: '光罩', category: 'equipment', market: 'sii' },
  { code: '1563', name: '巧新', category: 'equipment', market: 'sii' },
  { code: '3587', name: '閎康', category: 'equipment', market: 'otc' },
  { code: '5443', name: '均豪', category: 'equipment', market: 'otc' },
  { code: '2464', name: '盟立', category: 'equipment', market: 'sii' },
  { code: '3563', name: '牧德', category: 'equipment', market: 'otc' },
  { code: '6664', name: '群翊', category: 'equipment', market: 'otc' },
  { code: '3163', name: '波若威', category: 'equipment', market: 'otc' },
  { code: '6849', name: '奇鼎', category: 'equipment', market: 'otc' },
  { code: '8374', name: '羅昇', category: 'equipment', market: 'otc' },
  { code: '8027', name: '鈦昇', category: 'equipment', market: 'otc' },
  { code: '6706', name: '惠特', category: 'equipment', market: 'otc' },
  { code: '3289', name: '宜特', category: 'equipment', market: 'otc' },
  { code: '8064', name: '東捷', category: 'equipment', market: 'otc' },
  { code: '6438', name: '迅得', category: 'equipment', market: 'sii' },
  { code: '3055', name: '蔚華科', category: 'equipment', market: 'sii' },
  { code: '6953', name: '家碩', category: 'equipment', market: 'sii' },
  { code: '4526', name: '東台', category: 'equipment', market: 'otc' },
  { code: '6788', name: '華景電', category: 'equipment', market: 'rotc' },
  { code: '4549', name: '桓達', category: 'equipment', market: 'otc' },
  { code: '6739', name: '竹陞科技', category: 'equipment', market: 'rotc' },
  { code: '8111', name: '立碁', category: 'equipment', market: 'otc' },
  { code: '3455', name: '由田', category: 'equipment', market: 'otc' },
  { code: '6830', name: '汎銓', category: 'equipment', market: 'sii' },
  { code: '3535', name: '晶彩科', category: 'equipment', market: 'otc' },
  { code: '6208', name: '日揚', category: 'equipment', market: 'otc' },
  { code: '3551', name: '世禾', category: 'equipment', market: 'otc' },
  { code: '4908', name: '前鼎光電', category: 'equipment', market: 'otc' },
  { code: '6215', name: '和椿', category: 'equipment', market: 'sii' },
  { code: '4580', name: '捷流閥業', category: 'equipment', market: 'otc' },
  { code: '3178', name: '公準', category: 'equipment', market: 'otc' },
  { code: '3580', name: '友威科', category: 'equipment', market: 'otc' },
  { code: '7704', name: '明遠', category: 'equipment', market: 'rotc' },
  { code: '6207', name: '雷科', category: 'equipment', market: 'otc' },
  { code: '7556', name: '意德士', category: 'equipment', market: 'rotc' },
  { code: '6532', name: '瑞耘', category: 'equipment', market: 'sii' },
  { code: '4542', name: '科嶠', category: 'equipment', market: 'otc' },
  { code: '3581', name: '博磊', category: 'equipment', market: 'otc' },
  { code: '6667', name: '信紘科', category: 'equipment', market: 'otc' },
  { code: '6829', name: '千附精密', category: 'equipment', market: 'sii' },
  { code: '3030', name: '德律', category: 'equipment', market: 'sii' },
  { code: '7822', name: '倍利', category: 'equipment', market: 'rotc' },
  { code: '7751', name: '竑騰', category: 'equipment', market: 'rotc' },
  { code: '7730', name: '暉盛', category: 'equipment', market: 'rotc' },
  { code: '7728', name: '光焱科技', category: 'equipment', market: 'rotc' },
  { code: '6909', name: '創控', category: 'equipment', market: 'otc' },
  { code: '3498', name: '陽程', category: 'equipment', market: 'otc' },

  // === 廠區服務 (16) ===
  { code: '2404', name: '漢唐', category: 'facility', market: 'sii' },
  { code: '6139', name: '亞翔', category: 'facility', market: 'sii' },
  { code: '6691', name: '洋基工程', category: 'facility', market: 'sii' },
  { code: '6196', name: '帆宣', category: 'facility', market: 'sii' },
  { code: '5536', name: '聖暉', category: 'facility', market: 'sii' },
  { code: '6613', name: '朋億', category: 'facility', market: 'otc' },
  { code: '6826', name: '和淞', category: 'facility', market: 'otc' },
  { code: '6903', name: '巨漢', category: 'facility', market: 'otc' },
  { code: '3402', name: '漢科', category: 'facility', market: 'otc' },
  { code: '8383', name: '千附實業', category: 'facility', market: 'otc' },
  { code: '7721', name: '微程式', category: 'facility', market: 'otc' },
  { code: '6944', name: '兆聯', category: 'facility', market: 'otc' },
  { code: '6192', name: '巨路', category: 'facility', market: 'otc' },
  { code: '7820', name: '立盈環保', category: 'facility', market: 'rotc' },
  { code: '7631', name: '聚賢研發', category: 'facility', market: 'rotc' },
  { code: '7813', name: '宇辰', category: 'facility', market: 'rotc' },

  // === 材料服務 (41) ===
  { code: '5347', name: '世界先進', category: 'materials', market: 'sii' },
  { code: '6488', name: '環球晶', category: 'materials', market: 'otc' },
  { code: '3037', name: '欣興', category: 'materials', market: 'sii' },
  { code: '4958', name: '臻鼎-KY', category: 'materials', market: 'sii' },
  { code: '1229', name: '聯華食品', category: 'materials', market: 'sii' },
  { code: '3532', name: '台勝科', category: 'materials', market: 'otc' },
  { code: '6223', name: '旺矽', category: 'materials', market: 'sii' },
  { code: '6515', name: '穎崴', category: 'materials', market: 'sii' },
  { code: '3105', name: '穩懋', category: 'materials', market: 'otc' },
  { code: '5434', name: '崇越', category: 'materials', market: 'sii' },
  { code: '4749', name: '新應材', category: 'materials', market: 'otc' },
  { code: '1560', name: '中砂', category: 'materials', market: 'sii' },
  { code: '1773', name: '勝一', category: 'materials', market: 'sii' },
  { code: '1785', name: '光洋科', category: 'materials', market: 'sii' },
  { code: '3081', name: '聯亞', category: 'materials', market: 'otc' },
  { code: '1717', name: '長興', category: 'materials', market: 'sii' },
  { code: '3010', name: '華立', category: 'materials', market: 'sii' },
  { code: '8070', name: '長華', category: 'materials', market: 'sii' },
  { code: '4772', name: '台特化', category: 'materials', market: 'otc' },
  { code: '6182', name: '合晶', category: 'materials', market: 'sii' },
  { code: '8028', name: '昇陽半', category: 'materials', market: 'otc' },
  { code: '3663', name: '鑫科材料', category: 'materials', market: 'otc' },
  { code: '4768', name: '晶呈科', category: 'materials', market: 'otc' },
  { code: '6510', name: '精測', category: 'materials', market: 'otc' },
  { code: '5234', name: '達興材料', category: 'materials', market: 'otc' },
  { code: '4755', name: '三福化工', category: 'materials', market: 'otc' },
  { code: '1711', name: '永光', category: 'materials', market: 'sii' },
  { code: '6683', name: '雍智', category: 'materials', market: 'otc' },
  { code: '8091', name: '翔名', category: 'materials', market: 'otc' },
  { code: '3444', name: '利機', category: 'materials', market: 'sii' },
  { code: '6217', name: '中探針', category: 'materials', market: 'otc' },
  { code: '6959', name: '兆捷科技', category: 'materials', market: 'rotc' },
  { code: '1727', name: '中華化', category: 'materials', market: 'sii' },
  { code: '5493', name: '三聯', category: 'materials', market: 'otc' },
  { code: '6823', name: '濾能', category: 'materials', market: 'otc' },
  { code: '4556', name: '旭然', category: 'materials', market: 'otc' },
  { code: '7768', name: '頌勝科技', category: 'materials', market: 'rotc' },
  { code: '4960', name: '誠美材', category: 'materials', market: 'otc' },
  { code: '7703', name: '銳澤', category: 'materials', market: 'rotc' },
  { code: '3467', name: '台灣精材', category: 'materials', market: 'sii' },
  { code: '3430', name: '奇鈦科', category: 'materials', market: 'otc' },
];

function main() {
  const dryRun = process.argv.includes('--dry-run');

  // 完整性檢查：代碼唯一、總數 132
  const codeSet = new Set();
  for (const c of COMPANIES) {
    if (codeSet.has(c.code)) {
      console.error(`[錯誤] 重複代碼：${c.code}`);
      process.exit(1);
    }
    codeSet.add(c.code);
  }
  const counts = COMPANIES.reduce((acc, c) => {
    acc[c.category] = (acc[c.category] || 0) + 1;
    return acc;
  }, {});
  const marketCounts = COMPANIES.reduce((acc, c) => {
    acc[c.market] = (acc[c.market] || 0) + 1;
    return acc;
  }, {});

  // 標記 isCore
  const entries = COMPANIES.map(c => ({ ...c, isCore: CORE_49.has(c.code) }));
  const coreCount = entries.filter(e => e.isCore).length;

  console.log('=== QIC Semi Supply Chain 匯入預覽 ===');
  console.log(`總數：${entries.length} 家`);
  console.log(`分類：設備 ${counts.equipment || 0}、廠服 ${counts.facility || 0}、材料 ${counts.materials || 0}`);
  console.log(`市場：上市 ${marketCounts.sii || 0}、上櫃 ${marketCounts.otc || 0}、興櫃 ${marketCounts.rotc || 0}`);
  console.log(`核心 (2024 初版 49 家)：${coreCount} 家`);

  // 驗證 49 家都在 COMPANIES 內
  const missingCore = [...CORE_49].filter(code => !codeSet.has(code));
  if (missingCore.length > 0) {
    console.error(`[錯誤] 49 家核心名單中有 ${missingCore.length} 個代碼不在 132 家清單裡：${missingCore.join(', ')}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n[dry-run] 未寫入檔案。執行時移除 --dry-run 即可實際匯入。');
    return;
  }

  const result = twStockStore.importWatchlist(entries, 'QIC Import (PDF)');
  console.log('\n=== 匯入結果 ===');
  console.log(`新增：${result.added}`);
  console.log(`合併（已存在，補 category/isCore）：${result.merged}`);
  console.log(`略過（格式錯誤）：${result.skipped}`);
  console.log(`watchlist 目前總數：${result.total}`);
}

main();
