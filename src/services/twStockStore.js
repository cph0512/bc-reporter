// src/services/twStockStore.js
// JSON-file backed store for Taiwan stock watchlist + cached financial data

const fs = require('fs');
const path = require('path');
const { resolveDataFile } = require('./dataDir');

const TW_STOCK_FILE = resolveDataFile('tw-stock.json');

const DEFAULT_DATA = { watchlist: [], financials: {} };

function readData() {
  try {
    if (!fs.existsSync(TW_STOCK_FILE)) return { ...DEFAULT_DATA };
    const raw = JSON.parse(fs.readFileSync(TW_STOCK_FILE, 'utf8'));
    return {
      watchlist: raw.watchlist || [],
      financials: raw.financials || {},
    };
  } catch { return { ...DEFAULT_DATA }; }
}

function writeData(data) {
  const dir = path.dirname(TW_STOCK_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TW_STOCK_FILE, JSON.stringify(data, null, 2), 'utf8');
}

const twStockStore = {
  // ===== 追蹤清單 =====

  getWatchlist() {
    return readData().watchlist;
  },

  addToWatchlist(code, name, market = 'sii', addedBy = '', extras = {}) {
    const data = readData();
    if (data.watchlist.find(w => w.code === code)) {
      throw new Error(`股票 ${code} 已在追蹤清單中`);
    }
    const entry = {
      code,
      name,
      market,
      addedBy,
      addedAt: new Date().toISOString(),
    };
    if (extras.category) entry.category = extras.category;
    if (typeof extras.isCore === 'boolean') entry.isCore = extras.isCore;
    data.watchlist.push(entry);
    writeData(data);
    return data.watchlist;
  },

  /**
   * 批次匯入追蹤清單 — 已存在的代碼只補 category / isCore，不覆蓋 name / market / addedBy / addedAt
   * @param {Array<{code,name,market?,category?,isCore?}>} entries
   * @param {string} addedBy
   * @returns {{added:number, merged:number, skipped:number, total:number}}
   */
  importWatchlist(entries, addedBy = '') {
    const data = readData();
    let added = 0;
    let merged = 0;
    let skipped = 0;
    for (const e of entries) {
      if (!e || !e.code || !e.name) { skipped++; continue; }
      const code = String(e.code).trim();
      if (!/^\d{4,6}$/.test(code)) { skipped++; continue; }
      const existing = data.watchlist.find(w => w.code === code);
      if (existing) {
        let changed = false;
        if (e.category && existing.category !== e.category) { existing.category = e.category; changed = true; }
        if (typeof e.isCore === 'boolean' && existing.isCore !== e.isCore) { existing.isCore = e.isCore; changed = true; }
        if (changed) merged++;
      } else {
        const entry = {
          code,
          name: String(e.name).trim(),
          market: e.market || 'sii',
          addedBy,
          addedAt: new Date().toISOString(),
        };
        if (e.category) entry.category = e.category;
        if (typeof e.isCore === 'boolean') entry.isCore = e.isCore;
        data.watchlist.push(entry);
        added++;
      }
    }
    writeData(data);
    return { added, merged, skipped, total: data.watchlist.length };
  },

  removeFromWatchlist(code) {
    const data = readData();
    const idx = data.watchlist.findIndex(w => w.code === code);
    if (idx === -1) throw new Error(`股票 ${code} 不在追蹤清單中`);
    data.watchlist.splice(idx, 1);
    // 同時清除快取的財報資料
    delete data.financials[code];
    writeData(data);
    return data.watchlist;
  },

  getStock(code) {
    const data = readData();
    return data.watchlist.find(w => w.code === code) || null;
  },

  // ===== 財報資料快取 =====

  getFinancials(code) {
    const data = readData();
    return data.financials[code] || null;
  },

  getIncomeStatements(code) {
    const fin = this.getFinancials(code);
    return fin?.income || {};
  },

  getBalanceSheets(code) {
    const fin = this.getFinancials(code);
    return fin?.balance || {};
  },

  getCashFlows(code) {
    const fin = this.getFinancials(code);
    return fin?.cashflow || {};
  },

  getRevenue(code) {
    const fin = this.getFinancials(code);
    return fin?.revenue || {};
  },

  getLastSync(code) {
    const fin = this.getFinancials(code);
    return fin?.lastSync || null;
  },

  /**
   * 判斷是否需要重新同步
   * @param {string} code
   * @param {number} maxAgeMs - 最大快取時間（預設 24 小時）
   */
  needsSync(code, maxAgeMs = 24 * 60 * 60 * 1000) {
    const lastSync = this.getLastSync(code);
    if (!lastSync) return true;
    return (Date.now() - new Date(lastSync).getTime()) > maxAgeMs;
  },

  /**
   * 儲存抓取到的完整財報資料
   */
  saveFinancials(code, financials) {
    const data = readData();
    if (!data.financials[code]) {
      data.financials[code] = {};
    }
    // 合併新資料（不覆蓋已有的）
    for (const type of ['income', 'balance', 'cashflow', 'revenue']) {
      if (financials[type]) {
        if (!data.financials[code][type]) {
          data.financials[code][type] = {};
        }
        Object.assign(data.financials[code][type], financials[type]);
      }
    }
    data.financials[code].lastSync = new Date().toISOString();
    writeData(data);
  },

  // 完整原始資料存取（for deployment sync）
  getRawData() {
    return readData();
  },

  setRawData(data) {
    writeData(data);
  },
};

module.exports = twStockStore;
