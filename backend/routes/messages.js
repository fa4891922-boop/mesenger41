const express = require('express');
const { pool } = require('../db');
const authenticate = require('../middleware/auth');

module.exports = (io, onlineUsers) => {
  const router = express.Router();

  router.get('/messages/:userId', authenticate, async (req, res) => {
    const userId = parseInt(req.params.userId);
    if (!userId || isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = parseInt(req.query.before) || null;
    try {
      let query = `SELECT m.*, u.display_name as sender_name
         FROM private_messages m
         JOIN users u ON m.sender_id = u.id
         WHERE ((m.sender_id = $1 AND m.receiver_id = $2 AND m.deleted_for_sender = FALSE)
            OR (m.sender_id = $2 AND m.receiver_id = $1 AND m.deleted_for_receiver = FALSE))`;
      const params = [req.user.id, userId];
      if (before) {
        query += ` AND m.id < $3 ORDER BY m.created_at DESC LIMIT $4`;
        params.push(before, limit + 1);
      } else {
        query += ` ORDER BY m.created_at DESC LIMIT $3`;
        params.push(limit + 1);
      }
      const result = await pool.query(query, params);
      const hasMore = result.rows.length > limit;
      const messages = hasMore ? result.rows.slice(0, limit) : result.rows;
      messages.reverse();
      res.json({ messages, hasMore });
    } catch (err) {
      console.error('GET /api/messages error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/messages/:messageId', authenticate, async (req, res) => {
    const { forEveryone } = req.body || {};
    const messageId = parseInt(req.params.messageId);
    if (!messageId || isNaN(messageId)) return res.status(400).json({ error: 'Invalid message ID' });
    try {
      const msg = await pool.query('SELECT * FROM private_messages WHERE id = $1', [messageId]);
      if (!msg.rows[0]) return res.status(404).json({ error: 'Message not found' });
      const m = msg.rows[0];
      if (m.sender_id !== req.user.id && m.receiver_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (forEveryone && m.sender_id === req.user.id) {
        await pool.query('DELETE FROM private_messages WHERE id = $1', [messageId]);
        const receiverSocketId = onlineUsers.get(m.receiver_id);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('message_deleted', { messageId, forEveryone: true });
        }
      } else {
        const col = m.sender_id === req.user.id ? 'deleted_for_sender' : 'deleted_for_receiver';
        await pool.query(`UPDATE private_messages SET ${col} = TRUE WHERE id = $1`, [messageId]);
      }
      res.json({ success: true });
    } catch (err) {
      console.error('DELETE /api/messages error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.put('/messages/:messageId', authenticate, async (req, res) => {
    const { content } = req.body;
    const messageId = parseInt(req.params.messageId);
    if (!messageId || isNaN(messageId)) return res.status(400).json({ error: 'Invalid message ID' });
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
    if (typeof content !== 'string' || content.length > 5000) return res.status(400).json({ error: 'Invalid content' });
    try {
      const msg = await pool.query('SELECT * FROM private_messages WHERE id = $1 AND sender_id = $2', [messageId, req.user.id]);
      if (!msg.rows[0]) return res.status(404).json({ error: 'Message not found or not yours' });

      const result = await pool.query(
        'UPDATE private_messages SET content = $1, edited_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [content.trim(), messageId]
      );
      const updated = result.rows[0];
      const receiverSocketId = onlineUsers.get(updated.receiver_id);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('message_edited', updated);
      }
      res.json(updated);
    } catch (err) {
      console.error('PUT /api/messages error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
