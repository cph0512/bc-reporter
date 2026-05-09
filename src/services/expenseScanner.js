// src/services/expenseScanner.js
// AI expense receipt / invoice scanning.
// Defaults to the same OpenAI-compatible style used by the LINE bot (Qwen).

const axios = require('axios');

const EXPENSE_SCAN_PROVIDER = String(process.env.EXPENSE_SCAN_PROVIDER || 'qwen').trim().toLowerCase();
const EXPENSE_SCAN_API_URL = buildChatCompletionsUrl(
  process.env.EXPENSE_SCAN_API_URL
  || process.env.LINE_DIRECT_API_URL
  || process.env.QWEN_API_URL
  || process.env.QWEN_API_BASE
  || process.env.OPENAI_API_BASE
  || process.env.OPENAI_BASE_URL
);
const EXPENSE_SCAN_API_KEY = String(
  process.env.EXPENSE_SCAN_API_KEY
  || process.env.LINE_DIRECT_API_KEY
  || process.env.QWEN_API_KEY
  || process.env.OPENAI_API_KEY
  || ''
).trim();
const EXPENSE_SCAN_MODEL = String(
  process.env.EXPENSE_SCAN_MODEL
  || process.env.LINE_DIRECT_API_MODEL
  || process.env.QWEN_MODEL
  || 'qwen3.6-plus'
).trim();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const EXPENSE_SCAN_PROMPT = `你是台灣公司費用報帳的發票/收據辨識助手。請分析圖片中的發票、收據、請款單或消費憑證，擷取可用於費用簽收單的資料。

請只回傳 JSON，不要加 markdown code block。格式如下：
{
  "payee": "付款對象/店家/供應商名稱",
  "department": "",
  "requestDate": "",
  "payment": {
    "paymentMethod": "",
    "bankName": "",
    "branchName": "",
    "accountName": "",
    "accountNumber": ""
  },
  "items": [
    {
      "invoiceDate": "YYYY-MM-DD",
      "invoiceNo": "發票號碼或單據號碼",
      "summary": "費用摘要，例：停車費/油資/文具/客戶拜訪餐費",
      "quantity": 1,
      "taxIncludedUnitPrice": 0
    }
  ],
  "totalAmount": 0,
  "taxAmount": 0,
  "untaxedAmount": 0,
  "confidence": 0.9,
  "warnings": ["需要人工確認的事項"]
}

規則：
- 日期請轉成西元 YYYY-MM-DD；無法判斷則留空字串。
- 金額請回傳數字，不要逗號或貨幣符號。
- 若只有總金額，請建立一筆 items，quantity = 1，taxIncludedUnitPrice = 總金額。
- 若有統一發票號碼，放 invoiceNo；若只有收據編號/訂單號，也可放 invoiceNo。
- 摘要要短，盡量描述費用用途，不要整段 OCR 原文。
- 不確定的欄位留空，並在 warnings 裡說明。
- 不要臆測付款銀行/帳號，除非圖片上清楚可見。`;

function buildChatCompletionsUrl(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!base) return '';
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

function activeProvider() {
  if (EXPENSE_SCAN_PROVIDER === 'auto') {
    if (EXPENSE_SCAN_API_URL && EXPENSE_SCAN_API_KEY) return 'openai-compatible';
    if (GEMINI_API_KEY) return 'gemini';
  }
  if (EXPENSE_SCAN_PROVIDER === 'gemini' || EXPENSE_SCAN_PROVIDER === 'google') return 'gemini';
  return 'openai-compatible';
}

function parseGeminiJson(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in AI response');
  return JSON.parse(jsonMatch[0]);
}

function summarizeApiError(data) {
  if (!data) return '';
  if (typeof data === 'string') return data.slice(0, 300);
  const message = data.error?.message || data.message || data.error || data.detail;
  if (message) return String(message).slice(0, 300);
  try {
    return JSON.stringify(data).slice(0, 300);
  } catch {
    return '';
  }
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normalizeScan(parsed = {}, fileName = '') {
  const fallbackTotal = normalizeNumber(parsed.totalAmount);
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const normalizedItems = items
    .map((item) => ({
      invoiceDate: item.invoiceDate || parsed.invoiceDate || '',
      invoiceNo: String(item.invoiceNo || parsed.invoiceNo || '').trim(),
      summary: String(item.summary || parsed.summary || parsed.payee || fileName || '費用').trim(),
      quantity: normalizeNumber(item.quantity) || 1,
      taxIncludedUnitPrice: normalizeNumber(item.taxIncludedUnitPrice || item.amount || item.total),
    }))
    .filter(item => item.summary || item.invoiceNo || item.taxIncludedUnitPrice > 0);

  if (!normalizedItems.length && fallbackTotal > 0) {
    normalizedItems.push({
      invoiceDate: parsed.invoiceDate || '',
      invoiceNo: String(parsed.invoiceNo || '').trim(),
      summary: String(parsed.summary || parsed.payee || fileName || '費用').trim(),
      quantity: 1,
      taxIncludedUnitPrice: fallbackTotal,
    });
  }

  return {
    payee: String(parsed.payee || parsed.vendor || parsed.merchant || '').trim(),
    department: String(parsed.department || '').trim(),
    requestDate: parsed.requestDate || '',
    payment: parsed.payment || {},
    items: normalizedItems,
    totalAmount: fallbackTotal,
    taxAmount: normalizeNumber(parsed.taxAmount),
    untaxedAmount: normalizeNumber(parsed.untaxedAmount),
    confidence: normalizeNumber(parsed.confidence) || 0.5,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter(Boolean) : [],
    raw_result: parsed,
  };
}

async function callOpenAiCompatibleVision(base64Image, mimeType) {
  if (!EXPENSE_SCAN_API_URL || !EXPENSE_SCAN_API_KEY) {
    throw new Error('Qwen 辨識設定未完成：請設定 EXPENSE_SCAN_API_URL/EXPENSE_SCAN_API_KEY，或沿用 bot 的 LINE_DIRECT_API_URL/LINE_DIRECT_API_KEY');
  }

  const imageUrl = String(base64Image || '').startsWith('data:')
    ? base64Image
    : `data:${mimeType};base64,${base64Image}`;
  const payload = {
    model: EXPENSE_SCAN_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: EXPENSE_SCAN_PROMPT },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 4096,
  };

  let response;
  try {
    response = await axios.post(EXPENSE_SCAN_API_URL, payload, {
      headers: {
        Authorization: `Bearer ${EXPENSE_SCAN_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 45000,
    });
  } catch (err) {
    const status = err.response?.status;
    const body = summarizeApiError(err.response?.data);
    if (status) throw new Error(`Qwen API ${status}: ${body || err.message}`);
    throw err;
  }

  const choice = response.data?.choices?.[0] || {};
  let content = choice.message?.content || choice.text || '';
  if (Array.isArray(content)) {
    content = content
      .map(part => (typeof part === 'string' ? part : (part.text || '')))
      .join('');
  }
  return String(content || '').trim();
}

async function callGeminiVision(base64Image, mimeType) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY 未設定，無法辨識附件');
  }

  const payload = {
    contents: [{
      parts: [
        { text: EXPENSE_SCAN_PROMPT },
        { inline_data: { mime_type: mimeType, data: base64Image } },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
    },
  };

  const response = await axios.post(GEMINI_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY,
    },
    timeout: 35000,
  });

  return response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function scanExpenseImage(base64Image, mimeType = 'image/jpeg', fileName = '') {
  if (!String(mimeType || '').startsWith('image/')) {
    throw new Error('目前附件辨識僅支援圖片格式');
  }

  const startedAt = Date.now();
  const provider = activeProvider();
  const text = provider === 'gemini'
    ? await callGeminiVision(base64Image, mimeType)
    : await callOpenAiCompatibleVision(base64Image, mimeType);
  let parsed;
  try {
    parsed = parseGeminiJson(text);
  } catch (e) {
    throw new Error(`AI 回傳格式無法解析: ${e.message}`);
  }

  return {
    ...normalizeScan(parsed, fileName),
    provider,
    model: provider === 'gemini' ? GEMINI_MODEL : EXPENSE_SCAN_MODEL,
    durationMs: Date.now() - startedAt,
  };
}

async function scanExpenseBatch(images) {
  const results = [];
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const startedAt = Date.now();
    try {
      const result = await scanExpenseImage(image.base64, image.mimeType, image.fileName);
      results.push({
        index: i,
        fileName: image.fileName || `receipt_${i + 1}`,
        success: true,
        ...result,
      });
    } catch (err) {
      results.push({
        index: i,
        fileName: image.fileName || `receipt_${i + 1}`,
        success: false,
        error: err.message,
        durationMs: Date.now() - startedAt,
      });
    }
    if (i < images.length - 1) await sleep(500);
  }
  return results;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { scanExpenseImage, scanExpenseBatch };
