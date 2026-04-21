// src/services/twStockScraper.js
// 公開資訊觀測站 (MOPS) 台股財報資料抓取服務
// 獨立模組，未來可直接搬到獨立服務

const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://mops.twse.com.tw/mops/web';
const REQUEST_DELAY = 800; // ms between requests (polite scraping)

// 西元年轉民國年
function toROCYear(westernYear) {
  return westernYear - 1911;
}

// 延遲函式
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 通用 POST 請求
async function postMOPS(endpoint, params) {
  const url = `${BASE_URL}/${endpoint}`;
  const formData = new URLSearchParams({
    encodeURIComponent: '1',
    step: '1',
    firstin: '1',
    off: '1',
    ...params,
  });

  const response = await axios.post(url, formData.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (compatible; BCReporter/1.0)',
    },
    timeout: 30000,
    responseType: 'arraybuffer',
  });

  // MOPS 回應 Big5 編碼，需要轉換
  const decoder = new TextDecoder('big5');
  return decoder.decode(response.data);
}

// 解析 MOPS HTML table，回傳 key-value 物件陣列
function parseTable(html) {
  const $ = cheerio.load(html);
  const tables = $('table.hasBorder');

  if (tables.length === 0) return null;

  // 通常第一個 table 是資料表
  const table = tables.first();
  const headers = [];
  const rows = [];

  // 取得表頭
  table.find('tr.tblHead th, tr.tblHead td').each((_, el) => {
    headers.push($(el).text().trim());
  });

  // 如果沒有 tblHead，嘗試第一列作為表頭
  if (headers.length === 0) {
    table.find('tr').first().find('th, td').each((_, el) => {
      headers.push($(el).text().trim());
    });
  }

  // 取得資料列
  table.find('tr').each((i, tr) => {
    const cells = [];
    $(tr).find('td').each((_, td) => {
      cells.push($(td).text().trim());
    });
    if (cells.length > 0 && cells.length >= headers.length - 1) {
      rows.push(cells);
    }
  });

  return { headers, rows };
}

// 解析財報 HTML — 個股單一報表格式（科目 + 金額 + 百分比）
function parseFinancialStatement(html) {
  const $ = cheerio.load(html);
  const result = {};

  // MOPS 個股財報回傳多個 table
  $('table.hasBorder').each((tableIdx, table) => {
    const rows = [];
    $(table).find('tr').each((i, tr) => {
      const cells = [];
      $(tr).find('th, td').each((_, cell) => {
        cells.push($(cell).text().trim().replace(/,/g, ''));
      });
      if (cells.length > 0) rows.push(cells);
    });

    if (rows.length > 1) {
      // 第一列通常是表頭
      const header = rows[0];
      const data = rows.slice(1);
      const items = [];

      for (const row of data) {
        if (row.length >= 2) {
          const item = { name: row[0] };
          // 後續欄位為數值
          for (let j = 1; j < row.length && j < header.length; j++) {
            const key = header[j] || `col_${j}`;
            const val = row[j];
            item[key] = isNaN(Number(val)) ? val : Number(val);
          }
          items.push(item);
        }
      }

      if (items.length > 0) {
        result[`table_${tableIdx}`] = { header, items };
      }
    }
  });

  return Object.keys(result).length > 0 ? result : null;
}

// 解析月營收 HTML
function parseRevenueTable(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('table.hasBorder').each((_, table) => {
    const rows = [];
    $(table).find('tr').each((i, tr) => {
      const cells = [];
      $(tr).find('th, td').each((_, cell) => {
        cells.push($(cell).text().trim().replace(/,/g, ''));
      });
      if (cells.length > 0) rows.push(cells);
    });

    if (rows.length > 1) {
      const header = rows[0];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length >= 2) {
          const entry = {};
          for (let j = 0; j < row.length && j < header.length; j++) {
            const key = header[j] || `col_${j}`;
            const val = row[j];
            entry[key] = isNaN(Number(val)) ? val : Number(val);
          }
          results.push(entry);
        }
      }
    }
  });

  return results.length > 0 ? results : null;
}

/**
 * 抓取損益表 (綜合損益彙總表)
 * @param {string} stockCode - 股票代碼
 * @param {number} year - 西元年
 * @param {number} season - 季度 1-4
 * @param {string} market - 'sii' (上市) or 'otc' (上櫃)
 */
async function fetchIncomeStatement(stockCode, year, season, market = 'sii') {
  try {
    const html = await postMOPS('ajax_t163sb04', {
      TYPEK: market,
      year: toROCYear(year),
      season: String(season),
      co_id: stockCode,
    });
    return parseFinancialStatement(html);
  } catch (err) {
    console.error(`[twStockScraper] 損益表抓取失敗 ${stockCode} ${year}Q${season}:`, err.message);
    return null;
  }
}

/**
 * 抓取資產負債表
 */
async function fetchBalanceSheet(stockCode, year, season, market = 'sii') {
  try {
    const html = await postMOPS('ajax_t163sb05', {
      TYPEK: market,
      year: toROCYear(year),
      season: String(season),
      co_id: stockCode,
    });
    return parseFinancialStatement(html);
  } catch (err) {
    console.error(`[twStockScraper] 資產負債表抓取失敗 ${stockCode} ${year}Q${season}:`, err.message);
    return null;
  }
}

/**
 * 抓取現金流量表
 */
async function fetchCashFlow(stockCode, year, season, market = 'sii') {
  try {
    const html = await postMOPS('ajax_t164sb05', {
      TYPEK: market,
      year: toROCYear(year),
      season: String(season),
      co_id: stockCode,
    });
    return parseFinancialStatement(html);
  } catch (err) {
    console.error(`[twStockScraper] 現金流量表抓取失敗 ${stockCode} ${year}Q${season}:`, err.message);
    return null;
  }
}

/**
 * 抓取月營收 — 使用 FinMind API（MOPS 已封鎖直接存取）
 */
async function fetchMonthlyRevenue(stockCode, year, month, market = 'sii') {
  // Unused params kept for API compatibility
  try {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMonthRevenue&data_id=${stockCode}&start_date=${startDate}&end_date=${endDate}`;
    const response = await axios.get(url, { timeout: 15000 });
    const records = response.data?.data || [];
    if (records.length === 0) return null;
    // Convert to MOPS-like format for compatibility
    return records.map(r => ({
      '公司代號': r.stock_id,
      '當月營收': r.revenue,
      '上月營收': r.last_month_revenue || 0,
      '去年當月營收': r.last_year_revenue || 0,
      '上月比較增減(%)': r.revenue_month_growth_rate || 0,
      '去年同月增減(%)': r.revenue_year_growth_rate || 0,
      '營收年份': r.revenue_year,
      '營收月份': r.revenue_month,
    }));
  } catch (err) {
    console.error(`[twStockScraper] 月營收抓取失敗 ${stockCode} ${year}/${month}:`, err.message);
    return null;
  }
}

/**
 * 批次抓取某股票所有財報（3 年 x 4 季 + 月營收）
 * @param {string} stockCode
 * @param {string} market - 'sii' or 'otc'
 * @param {number} yearsBack - 回溯幾年（預設 3）
 * @param {function} onProgress - 進度回報 (current, total, label)
 */
async function fetchAllFinancials(stockCode, market = 'sii', yearsBack = 3, onProgress) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  // 目前季度（Q1=1-3, Q2=4-6, Q3=7-9, Q4=10-12）
  // 財報公布有延遲，最新可能只到上一季
  const currentSeason = Math.ceil(currentMonth / 3);
  const latestSeason = currentMonth <= 3 ? 4 : currentSeason - 1;
  const latestYear = currentMonth <= 3 ? currentYear - 1 : currentYear;

  const startYear = currentYear - yearsBack;
  const result = { income: {}, balance: {}, cashflow: {}, revenue: {} };

  let total = 0;
  let current = 0;

  // 計算任務總數（三大報表 + 月營收一次批次）
  for (let y = startYear; y <= latestYear; y++) {
    const maxSeason = (y === latestYear) ? latestSeason : 4;
    for (let s = 1; s <= maxSeason; s++) total += 3; // 3 reports per season
  }
  total += 1; // 月營收一次批次（FinMind 一股一 call，省配額）

  // 抓取三大報表
  for (let y = startYear; y <= latestYear; y++) {
    const maxSeason = (y === latestYear) ? latestSeason : 4;
    for (let s = 1; s <= maxSeason; s++) {
      const periodKey = `${y}_Q${s}`;

      if (onProgress) onProgress(++current, total, `損益表 ${periodKey}`);
      result.income[periodKey] = await fetchIncomeStatement(stockCode, y, s, market);
      await delay(REQUEST_DELAY);

      if (onProgress) onProgress(++current, total, `資產負債表 ${periodKey}`);
      result.balance[periodKey] = await fetchBalanceSheet(stockCode, y, s, market);
      await delay(REQUEST_DELAY);

      if (onProgress) onProgress(++current, total, `現金流量表 ${periodKey}`);
      result.cashflow[periodKey] = await fetchCashFlow(stockCode, y, s, market);
      await delay(REQUEST_DELAY);
    }
  }

  // 月營收：一次 FinMind call 拉回所有月份（等同 fetchRevenueOnly 的做法）
  if (onProgress) onProgress(++current, total, '月營收批次');
  result.revenue = await fetchRevenueOnly(stockCode, market, yearsBack);

  return result;
}

/**
 * 只抓月營收（FinMind 一次抓全部，約 2 秒 / 股）
 */
async function fetchRevenueOnly(stockCode, market = 'sii', yearsBack = 3) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const startYear = currentYear - yearsBack;
  const startDate = `${startYear}-01-01`;
  const result = {};

  try {
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMonthRevenue&data_id=${stockCode}&start_date=${startDate}`;
    const response = await axios.get(url, { timeout: 30000 });
    const records = response.data?.data || [];

    for (const r of records) {
      const monthKey = `${r.revenue_year}_${String(r.revenue_month).padStart(2, '0')}`;
      // Each month should have exactly 1 entry — use revenue_year+revenue_month as unique key
      result[monthKey] = [{
        '公司代號': r.stock_id,
        '當月營收': r.revenue,
        '上月營收': r.last_month_revenue || 0,
        '去年當月營收': r.last_year_revenue || 0,
        '上月比較增減(%)': r.revenue_month_growth_rate || 0,
        '去年同月增減(%)': r.revenue_year_growth_rate || 0,
        '營收年份': r.revenue_year,
        '營收月份': r.revenue_month,
      }];
    }
    console.log(`[FinMind] ${stockCode}: ${Object.keys(result).length} months`);
  } catch (err) {
    console.error(`[twStockScraper] FinMind 月營收抓取失敗 ${stockCode}:`, err.message);
  }
  return result;
}

module.exports = {
  fetchIncomeStatement,
  fetchBalanceSheet,
  fetchCashFlow,
  fetchMonthlyRevenue,
  fetchAllFinancials,
  fetchRevenueOnly,
  toROCYear,
};
