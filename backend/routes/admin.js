const express = require('express');
const { pool } = require('../db');
const authenticate = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const logger = require('../diagnostics/logger');

module.exports = (io, onlineUsers) => {
  const router = express.Router();

  router.post('/admin/ban/:userId', authenticate, requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.userId);
    if (!userId || isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });
    if (userId === req.user.id) return res.status(400).json({ error: 'Cannot ban yourself' });

    const { reason } = req.body || {};

    try {
      const userResult = await pool.query(
        'SELECT id, username, display_name, last_ip FROM users WHERE id = $1',
        [userId]
      );
      if (!userResult.rows[0]) return res.status(404).json({ error: 'User not found' });

      const target = userResult.rows[0];

      await pool.query(
        'UPDATE users SET is_banned = TRUE WHERE id = $1',
        [userId]
      );

      if (target.last_ip) {
        await pool.query(
          `INSERT INTO banned_ips (ip_address, user_id, reason, banned_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [target.last_ip, userId, reason || null, req.user.id]
        );
      }

      const socketId = onlineUsers.get(userId);
      if (socketId) {
        io.to(socketId).emit('banned');
        const socket = io.sockets.sockets.get(socketId);
        if (socket) socket.disconnect(true);
        onlineUsers.delete(userId);
      }

      logger.info('admin', 'user_banned', {
        userId: req.user.id,
        metadata: { targetId: userId, targetUsername: target.username, ip: target.last_ip },
      });

      res.json({
        success: true,
        banned: {
          userId: target.id,
          username: target.username,
          display_name: target.display_name,
          ip: target.last_ip,
        },
      });
    } catch (err) {
      logger.error('admin', 'ban_error', { errorMessage: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/admin/ban-ip', authenticate, requireAdmin, async (req, res) => {
    const { ip, reason } = req.body || {};
    if (!ip || typeof ip !== 'string') return res.status(400).json({ error: 'IP required' });

    try {
      await pool.query(
        `INSERT INTO banned_ips (ip_address, reason, banned_by)
         VALUES ($1, $2, $3)`,
        [ip.trim(), reason || null, req.user.id]
      );

      logger.info('admin', 'ip_banned', { userId: req.user.id, metadata: { ip: ip.trim() } });
      res.json({ success: true });
    } catch (err) {
      logger.error('admin', 'ban_ip_error', { errorMessage: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/admin/bans', authenticate, requireAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT b.id, b.ip_address, b.reason, b.created_at,
                u.username AS banned_username, u.display_name AS banned_display_name,
                a.username AS banned_by_username
         FROM banned_ips b
         LEFT JOIN users u ON b.user_id = u.id
         LEFT JOIN users a ON b.banned_by = a.id
         ORDER BY b.created_at DESC`
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/admin/banned-users', authenticate, requireAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, username, display_name, last_ip, last_seen
         FROM users WHERE is_banned = TRUE
         ORDER BY last_seen DESC`
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/admin/bans/:id', authenticate, requireAdmin, async (req, res) => {
    const banId = parseInt(req.params.id);
    if (!banId || isNaN(banId)) return res.status(400).json({ error: 'Invalid ban ID' });

    try {
      await pool.query('DELETE FROM banned_ips WHERE id = $1', [banId]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/admin/unban/:userId', authenticate, requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.userId);
    if (!userId || isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });

    try {
      await pool.query('UPDATE users SET is_banned = FALSE WHERE id = $1', [userId]);
      await pool.query('DELETE FROM banned_ips WHERE user_id = $1', [userId]);

      logger.info('admin', 'user_unbanned', { userId: req.user.id, metadata: { targetId: userId } });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
