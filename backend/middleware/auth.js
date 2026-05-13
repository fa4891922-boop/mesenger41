const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query('SELECT is_banned FROM users WHERE id = $1', [req.user.id]);
    if (result.rows[0]?.is_banned) {
      return res.status(403).json({ error: 'Account is banned' });
    }
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = authenticate;
