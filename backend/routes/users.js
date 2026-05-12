const express = require('express');
const { pool } = require('../db');
const authenticate = require('../middleware/auth');

const router = express.Router();

router.get('/users', authenticate, async (req, res) => {
  try {
    const search = req.query.search || '';
    let result;
    if (search) {
      result = await pool.query(
        'SELECT id, username, display_name, last_seen FROM users WHERE id != $1 AND (username ILIKE $2 OR display_name ILIKE $2) ORDER BY display_name',
        [req.user.id, `%${search}%`]
      );
    } else {
      result = await pool.query(
        'SELECT id, username, display_name, last_seen FROM users WHERE id != $1 ORDER BY display_name',
        [req.user.id]
      );
    }
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
