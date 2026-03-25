// src/middleware/security.js
// Security headers & CORS configuration (規範 §5.1)

const helmet = require('helmet');
const cors = require('cors');

/**
 * Helmet — adds security headers (CSP, HSTS, X-Frame-Options, etc.)
 */
function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://unpkg.com', 'https://cdn.jsdelivr.net'],
        scriptSrcAttr: ["'unsafe-inline'"],  // allow inline event handlers (onsubmit, onclick)
        styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false, // allow loading CDN resources
  });
}

/**
 * CORS — whitelist from env, fallback to allow-all in development
 */
function corsConfig() {
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : null;

  if (!allowedOrigins) {
    // Development: allow all (same as before)
    return cors();
  }

  return cors({
    origin(origin, callback) {
      // Allow requests with no origin (server-to-server, curl, etc.)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  });
}

module.exports = { securityHeaders, corsConfig };
