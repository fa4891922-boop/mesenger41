const { pool } = require('../db');

const banCheck = async (req, res, next) => {
  const ip = req.ip;
  try {
    const result = await pool.query(
      'SELECT 1 FROM banned_ips WHERE ip_address = $1 LIMIT 1',
      [ip]
    );
    if (result.rows.length > 0) {
      return res.status(403).json({ error: 'Access denied' });
    }
  } catch {
    // don't block on DB errors
  }
  next();
};

module.exports = banCheck;
