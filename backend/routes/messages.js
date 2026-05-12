const express = require('express');
const { pool } = require('../db');
const authenticate = require('../middleware/auth');
const logger = require('../diagnostics/logger');

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
      logger.info('message-flow', 'messages_loaded', {
        requestId: req.requestId,
        userId: req.user.id,
        metadata: { peerIdHash: logger.hashId(userId), count: messages.length, hasMore },
      });
      res.json({ messages, hasMore });
    } catch (err) {
      logger.error('message-flow', 'messages_load_error', {
        requestId: req.requestId,
        userId: req.user.id,
        errorMessage: err.message,
      });
      console.error('GET /api/messages error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/messages/:messageId', authenticate, async (req, res) => {
    const { forEveryone } = req.body || {};
    const messageId = parseInt(req.params.messageId);
    if (!messageId || isNaN(messageId)) return res.status(400).json({ error: 'Invalid message ID' });

    logger.info('delete-flow', 'delete_request_received', {
      requestId: req.requestId,
      userId: req.user.id,
      metadata: { messageId, forEveryone: !!forEveryone },
    });

    try {
      const msg = await pool.query('SELECT * FROM private_messages WHERE id = $1', [messageId]);
      if (!msg.rows[0]) {
        logger.warn('delete-flow', 'delete_message_not_found', { requestId: req.requestId, metadata: { messageId } });
        return res.status(404).json({ error: 'Message not found' });
      }
      const m = msg.rows[0];
      if (m.sender_id !== req.user.id && m.receiver_id !== req.user.id) {
        logger.warn('delete-flow', 'delete_permission_denied', {
          requestId: req.requestId,
          userId: req.user.id,
          metadata: { messageId, senderIdHash: logger.hashId(m.sender_id), receiverIdHash: logger.hashId(m.receiver_id) },
        });
        return res.status(403).json({ error: 'Forbidden' });
      }

      logger.info('delete-flow', 'delete_permission_check_passed', { requestId: req.requestId, metadata: { messageId } });

      if (forEveryone && m.sender_id === req.user.id) {
        await pool.query('DELETE FROM private_messages WHERE id = $1', [messageId]);
        logger.info('delete-flow', 'delete_db_success_for_everyone', { requestId: req.requestId, metadata: { messageId } });

        const receiverSocketId = onlineUsers.get(m.receiver_id);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('message_deleted', { messageId, forEveryone: true });
          logger.info('delete-flow', 'delete_ws_emit_success', {
            requestId: req.requestId,
            metadata: { messageId, receiverOnline: true },
          });
        } else {
          logger.info('delete-flow', 'delete_ws_receiver_offline', {
            requestId: req.requestId,
            metadata: { messageId, receiverOnline: false },
          });
        }
      } else {
        const col = m.sender_id === req.user.id ? 'deleted_for_sender' : 'deleted_for_receiver';
        await pool.query(`UPDATE private_messages SET ${col} = TRUE WHERE id = $1`, [messageId]);
        logger.info('delete-flow', 'delete_db_success_for_me', { requestId: req.requestId, metadata: { messageId, col } });
      }
      res.json({ success: true });
    } catch (err) {
      logger.error('delete-flow', 'delete_db_error', {
        requestId: req.requestId,
        errorMessage: err.message,
        metadata: { messageId },
      });
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
      logger.info('message-flow', 'message_edited', {
        requestId: req.requestId,
        userId: req.user.id,
        metadata: { messageId, contentLength: content.trim().length },
      });
      res.json(updated);
    } catch (err) {
      logger.error('message-flow', 'message_edit_error', {
        requestId: req.requestId,
        errorMessage: err.message,
        metadata: { messageId },
      });
      console.error('PUT /api/messages error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
