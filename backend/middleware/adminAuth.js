const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const logger = require('../diagnostics/logger');

const adminAuth = async (req, res, next) => {
  const diagToken = req.headers['x-diagnostics-token'];
  if (diagToken && process.env.ADMIN_DIAGNOSTICS_TOKEN) {
    if (diagToken === process.env.ADMIN_DIAGNOSTICS_TOKEN) {
      logger.info('auth', 'admin_token_auth_success', { requestId: req.requestId });
      req.adminAccess = 'token';
      return next();
    }
    logger.warn('auth', 'admin_token_auth_failed', { requestId: req.requestId });
  }

  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Authentication required', requestId: req.requestId });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query('SELECT is_admin FROM users WHERE id = $1', [decoded.id]);
    if (!result.rows[0]?.is_admin) {
      logger.warn('auth', 'admin_check_failed', { requestId: req.requestId, userId: decoded.id });
      return res.status(403).json({ error: 'Admin access required', requestId: req.requestId });
    }
    req.user = decoded;
    req.adminAccess = 'jwt';
    logger.info('auth', 'admin_jwt_auth_success', { requestId: req.requestId, userId: decoded.id });
    next();
  } catch (err) {
    logger.warn('auth', 'admin_auth_error', { requestId: req.requestId, errorMessage: err.message });
    res.status(401).json({ error: 'Invalid token', requestId: req.requestId });
  }
};

module.exports = adminAuth;
