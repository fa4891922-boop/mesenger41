const express = require('express');
const { pool } = require('../db');
const authenticate = require('../middleware/auth');

const router = express.Router();

router.post('/keys', authenticate, async (req, res) => {
  const { publicKey } = req.body;
  if (!publicKey || typeof publicKey !== 'string') {
    return res.status(400).json({ error: 'Public key required' });
  }
  if (publicKey.length > 1000) {
    return res.status(400).json({ error: 'Invalid key' });
  }

  try {
    await pool.query(
      `INSERT INTO user_keys (user_id, public_key) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET public_key = $2, created_at = CURRENT_TIMESTAMP`,
      [req.user.id, publicKey]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/keys error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/keys/:userId', authenticate, async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (!userId || isNaN(userId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  try {
    const result = await pool.query(
      'SELECT public_key FROM user_keys WHERE user_id = $1',
      [userId]
    );
    if (!result.rows[0]) {
      return res.json({ publicKey: null });
    }
    res.json({ publicKey: result.rows[0].public_key });
  } catch (err) {
    console.error('GET /api/keys error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
