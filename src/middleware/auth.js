// src/middleware/auth.js
// Session-based authentication middleware

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();

  // API requests get 401 JSON
  if (req.path.startsWith('/api/') || req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  // Page requests redirect to login
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
}

module.exports = { requireAuth, requireAdmin };
