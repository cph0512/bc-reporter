// src/services/geminiScanner.js
// AI business card scanning using Google Gemini Vision API

const axios = require('axios');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SCAN_PROMPT = `你是名片辨識專家。請分析這張名片圖片，擷取所有可見的聯絡人資訊。

請以下列 JSON 格式回傳（不要加 markdown code block）：
{
  "contact": {
    "full_name": "完整姓名",
    "first_name": "名",
    "last_name": "姓",
    "company": "公司名稱",
    "job_title": "職稱",
    "department": "部門",
    "emails": [{"value": "email@example.com", "label": "工作", "is_primary": true}],
    "phones": [{"value": "0912-345-678", "label": "手機", "is_primary": true}],
    "address": "完整地址",
    "website": "網站",
    "social_profiles": {"line_id": "", "linkedin": "", "facebook": ""}
  },
  "suggested_category": "客戶/供應商/合作夥伴/同業/其他",
  "confidence": 0.95,
  "notes": "其他備註資訊"
}

注意事項：
- 請辨識中文、英文、日文名片
- 姓名儘量拆分為 first_name 和 last_name
- 電話號碼保留原始格式
- Email 如有多個請全部列出
- confidence 為 0.0-1.0 的信心值
- 找不到的欄位請回傳空字串或空陣列
- suggested_category 請根據公司性質建議分類`;

/**
 * Scan a single business card image
 * @param {string} base64Image - Base64 encoded image data (without data URI prefix)
 * @param {string} mimeType - Image MIME type (image/jpeg, image/png, etc.)
 * @returns {Object} { contact, suggested_category, confidence, notes, raw_result, image_url }
 */
async function scanCard(base64Image, mimeType = 'image/jpeg') {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY 未設定，請在環境變數中配置');
  }

  const payload = {
    contents: [{
      parts: [
        { text: SCAN_PROMPT },
        { inline_data: { mime_type: mimeType, data: base64Image } },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
    },
  };

  const response = await axios.post(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Parse JSON from response (may be wrapped in ```json ... ```)
  let parsed;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in AI response');
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`AI 回傳格式無法解析: ${e.message}`);
  }

  return {
    parsed: parsed.contact || parsed,
    suggested_category: parsed.suggested_category || '其他',
    confidence: parsed.confidence || 0.5,
    notes: parsed.notes || '',
    raw_result: parsed,
  };
}

/**
 * Scan multiple business card images (sequential with rate limiting)
 * @param {Array<{base64: string, mimeType: string, fileName: string}>} images
 * @returns {Array<Object>} Array of scan results
 */
async function scanBatch(images) {
  const results = [];
  for (let i = 0; i < images.length; i++) {
    try {
      const result = await scanCard(images[i].base64, images[i].mimeType);
      results.push({
        index: i,
        fileName: images[i].fileName || `image_${i + 1}`,
        success: true,
        ...result,
      });
    } catch (err) {
      // Handle rate limiting with retry
      if (err.response?.status === 429) {
        const retryAfter = parseInt(err.response.headers['retry-after'] || '30', 10);
        await sleep(retryAfter * 1000);
        try {
          const result = await scanCard(images[i].base64, images[i].mimeType);
          results.push({ index: i, fileName: images[i].fileName || `image_${i + 1}`, success: true, ...result });
          continue;
        } catch (retryErr) {
          results.push({ index: i, fileName: images[i].fileName || `image_${i + 1}`, success: false, error: retryErr.message });
          continue;
        }
      }
      results.push({
        index: i,
        fileName: images[i].fileName || `image_${i + 1}`,
        success: false,
        error: err.message,
      });
    }
    // Rate limit delay between calls
    if (i < images.length - 1) await sleep(500);
  }
  return results;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { scanCard, scanBatch };
