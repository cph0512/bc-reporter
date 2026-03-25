// src/middleware/auditLog.js
// Audit logging for security-sensitive operations (規範 §7.1)

/**
 * Log a security-relevant event as structured JSON.
 * Sensitive fields (password, token, apiKey) are NEVER logged.
 */
function auditLog(action, req, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    ip: req.ip || req.connection?.remoteAddress,
    user: req.session?.user?.username || 'anonymous',
    userAgent: req.headers['user-agent'],
    ...details,
  };
  console.log(`[AUDIT] ${JSON.stringify(entry)}`);
}

/**
 * Express middleware that logs every API request (lightweight).
 * Does NOT log request bodies (may contain PII).
 */
function auditMiddleware(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    // Only log API and auth routes, skip static files
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
      const entry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: Date.now() - start,
        ip: req.ip || req.connection?.remoteAddress,
        user: req.session?.user?.username || 'anonymous',
      };
      console.log(`[ACCESS] ${JSON.stringify(entry)}`);
    }
  });
  next();
}

module.exports = { auditLog, auditMiddleware };
