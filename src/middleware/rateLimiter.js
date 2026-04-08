// src/middleware/rateLimiter.js
// Rate limiting configuration (規範 §5.1)

const rateLimit = require('express-rate-limit');

const SYNC_SECRET = process.env.SYNC_SECRET || '';

/**
 * Login rate limiter — prevent brute-force attacks
 * 10 attempts per 15 minutes per username (fallback to IP)
 * Internal bot calls with X-Internal-Key header bypass rate limiting
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: '登入嘗試次數過多，請 15 分鐘後再試' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit by username instead of IP so different users don't block each other
    return (req.body?.username || req.ip || 'unknown').toLowerCase();
  },
  skip: (req) => {
    // Internal bot calls bypass rate limiting
    const key = req.headers['x-internal-key'];
    return !!(key && SYNC_SECRET && key === SYNC_SECRET);
  },
});

/**
 * General API rate limiter
 * 100 requests per minute per IP
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: { error: '請求過於頻繁，請稍後再試' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * AI scan rate limiter — Gemini API calls are expensive
 * 20 requests per minute per IP
 */
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'AI 掃描請求過於頻繁，請稍後再試' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, apiLimiter, aiLimiter };
