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

function requireManagerOrAdmin(req, res, next) {
  const role = req.session?.user?.role;
  if (role === 'admin' || role === 'manager') return next();
  return res.status(403).json({ error: 'Manager or admin access required' });
}

/**
 * Dashboard access guard (factory).
 * Admins always pass. Users must have the dashboard in their `dashboards` array,
 * or have an empty/missing array (which means "all dashboards").
 */
function requireDashboard(dashboardName) {
  return (req, res, next) => {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (user.role === 'admin') return next();
    if (!user.dashboards || user.dashboards.length === 0) return next();
    if (user.dashboards.includes(dashboardName)) return next();
    return res.status(403).json({ error: 'Dashboard access denied' });
  };
}

/**
 * Strategy War Room role guard.
 * strategyRole field on user: 'finance_editor' | 'sales_manager' | 'viewer'
 * Admin always passes. Accepts an array of allowed roles.
 */
function requireStrategyRole(...allowedRoles) {
  return (req, res, next) => {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (user.role === 'admin') return next(); // admin bypasses all
    const sr = user.strategyRole || 'viewer';
    if (allowedRoles.includes(sr)) return next();
    return res.status(403).json({ error: `Strategy access denied. Required: ${allowedRoles.join(' or ')}` });
  };
}

module.exports = { requireAuth, requireAdmin, requireManagerOrAdmin, requireDashboard, requireStrategyRole };
