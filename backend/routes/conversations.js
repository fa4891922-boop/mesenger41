const express = require('express');
const { pool } = require('../db');
const authenticate = require('../middleware/auth');

const router = express.Router();

router.get('/conversations', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.last_seen,
        (SELECT content FROM private_messages pm
         WHERE ((pm.sender_id = u.id AND pm.receiver_id = $1 AND pm.deleted_for_receiver = FALSE)
            OR (pm.sender_id = $1 AND pm.receiver_id = u.id AND pm.deleted_for_sender = FALSE))
         ORDER BY pm.created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM private_messages pm
         WHERE ((pm.sender_id = u.id AND pm.receiver_id = $1 AND pm.deleted_for_receiver = FALSE)
            OR (pm.sender_id = $1 AND pm.receiver_id = u.id AND pm.deleted_for_sender = FALSE))
         ORDER BY pm.created_at DESC LIMIT 1) as last_message_at
       FROM users u
       WHERE u.id != $1
         AND EXISTS (
           SELECT 1 FROM private_messages pm
           WHERE ((pm.sender_id = u.id AND pm.receiver_id = $1 AND pm.deleted_for_receiver = FALSE)
              OR (pm.sender_id = $1 AND pm.receiver_id = u.id AND pm.deleted_for_sender = FALSE))
         )
       ORDER BY last_message_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/conversations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/conversations/:userId', authenticate, async (req, res) => {
  const otherId = parseInt(req.params.userId);
  if (!otherId || isNaN(otherId)) return res.status(400).json({ error: 'Invalid user ID' });
  try {
    await pool.query(
      `UPDATE private_messages SET deleted_for_sender = TRUE
       WHERE sender_id = $1 AND receiver_id = $2`,
      [req.user.id, otherId]
    );
    await pool.query(
      `UPDATE private_messages SET deleted_for_receiver = TRUE
       WHERE sender_id = $2 AND receiver_id = $1`,
      [otherId, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/conversations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
