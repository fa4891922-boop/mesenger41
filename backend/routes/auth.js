const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const authenticate = require('../middleware/auth');
const logger = require('../diagnostics/logger');

module.exports = (redisClient) => {
  const router = express.Router();

  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, try again later' },
  });

  const registerLimiter = rateLimit({
    windowMs: 3600 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many registrations, try again later' },
  });

  function generateAccessToken(user) {
    return jwt.sign(
      { id: user.id, username: user.username, displayName: user.display_name },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );
  }

  function generateRefreshToken() {
    return crypto.randomBytes(48).toString('hex');
  }

  async function storeRefreshToken(refreshToken, userId) {
    if (redisClient) {
      await redisClient.set(`refresh:${refreshToken}`, String(userId), { EX: 7 * 24 * 60 * 60 });
    }
  }

  async function verifyRefreshToken(refreshToken) {
    if (!redisClient) return null;
    const userId = await redisClient.get(`refresh:${refreshToken}`);
    return userId ? parseInt(userId) : null;
  }

  async function revokeRefreshToken(refreshToken) {
    if (redisClient) {
      await redisClient.del(`refresh:${refreshToken}`);
    }
  }

  router.post('/register', registerLimiter, async (req, res) => {
    const { username, password, displayName } = req.body;
    logger.info('auth', 'register_attempt', { requestId: req.requestId });

    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Invalid input' });
    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!/\d/.test(password)) return res.status(400).json({ error: 'Password must contain at least one number' });
    const sanitizedDisplayName = (displayName || username).slice(0, 50).trim();
    try {
      const hash = await bcrypt.hash(password, 10);
      const result = await pool.query(
        'INSERT INTO users (username, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, username, display_name',
        [username.toLowerCase().trim(), hash, sanitizedDisplayName]
      );
      const user = result.rows[0];
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken();
      await storeRefreshToken(refreshToken, user.id);
      pool.query('UPDATE users SET last_ip = $1 WHERE id = $2', [req.ip, user.id]).catch(() => {});
      logger.info('auth', 'register_success', { requestId: req.requestId, userId: user.id });
      res.json({ accessToken, refreshToken, user });
    } catch (err) {
      if (err.code === '23505') {
        logger.info('auth', 'register_failed_duplicate', { requestId: req.requestId });
        return res.status(400).json({ error: 'Username already taken' });
      }
      logger.error('auth', 'register_error', { requestId: req.requestId, errorMessage: err.message });
      console.error('POST /api/register error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/login', authLimiter, async (req, res) => {
    const { username, password } = req.body;
    logger.info('auth', 'login_attempt', { requestId: req.requestId });

    try {
      const result = await pool.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase().trim()]);
      const user = result.rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        logger.warn('auth', 'login_failed_credentials', { requestId: req.requestId });
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      if (user.is_banned) {
        return res.status(403).json({ error: 'Account is banned' });
      }
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken();
      await storeRefreshToken(refreshToken, user.id);
      pool.query('UPDATE users SET last_ip = $1 WHERE id = $2', [req.ip, user.id]).catch(() => {});
      logger.info('auth', 'login_success', { requestId: req.requestId, userId: user.id });
      res.json({ accessToken, refreshToken, user: { id: user.id, username: user.username, display_name: user.display_name } });
    } catch (err) {
      logger.error('auth', 'login_error', { requestId: req.requestId, errorMessage: err.message });
      console.error('POST /api/login error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken || typeof refreshToken !== 'string') {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    try {
      const userId = await verifyRefreshToken(refreshToken);
      if (!userId) {
        return res.status(401).json({ error: 'Invalid or expired refresh token' });
      }

      const result = await pool.query(
        'SELECT id, username, display_name, is_banned FROM users WHERE id = $1',
        [userId]
      );
      if (!result.rows[0]) {
        await revokeRefreshToken(refreshToken);
        return res.status(401).json({ error: 'User not found' });
      }
      if (result.rows[0].is_banned) {
        await revokeRefreshToken(refreshToken);
        return res.status(403).json({ error: 'Account is banned' });
      }

      const user = result.rows[0];
      const accessToken = generateAccessToken(user);
      const newRefreshToken = generateRefreshToken();

      await revokeRefreshToken(refreshToken);
      await storeRefreshToken(newRefreshToken, user.id);

      res.json({ accessToken, refreshToken: newRefreshToken });
    } catch (err) {
      logger.error('auth', 'refresh_error', { requestId: req.requestId, errorMessage: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/logout', authenticate, async (req, res) => {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
    logger.info('auth', 'logout', { requestId: req.requestId, userId: req.user.id });
    res.json({ success: true });
  });

  router.get('/me', authenticate, async (req, res) => {
    try {
      const result = await pool.query('SELECT id, username, display_name, is_admin FROM users WHERE id = $1', [req.user.id]);
      if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
      res.json(result.rows[0]);
    } catch (err) {
      logger.error('auth', 'me_error', { requestId: req.requestId, errorMessage: err.message });
      console.error('GET /api/me error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
