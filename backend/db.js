const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS private_messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER REFERENCES users(id),
      receiver_id INTEGER REFERENCES users(id),
      content TEXT NOT NULL,
      edited_at TIMESTAMP,
      deleted_for_sender BOOLEAN DEFAULT FALSE,
      deleted_for_receiver BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS banned_ips (
      id SERIAL PRIMARY KEY,
      ip_address TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      reason TEXT,
      banned_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_keys (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      public_key TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const cols = [
    { table: 'private_messages', col: 'edited_at', type: 'TIMESTAMP' },
    { table: 'private_messages', col: 'deleted_for_sender', type: 'BOOLEAN DEFAULT FALSE' },
    { table: 'private_messages', col: 'deleted_for_receiver', type: 'BOOLEAN DEFAULT FALSE' },
    { table: 'private_messages', col: 'encrypted', type: 'BOOLEAN DEFAULT FALSE' },
    { table: 'users', col: 'last_seen', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
    { table: 'users', col: 'is_admin', type: 'BOOLEAN DEFAULT FALSE' },
    { table: 'users', col: 'is_banned', type: 'BOOLEAN DEFAULT FALSE' },
    { table: 'users', col: 'last_ip', type: 'TEXT' },
  ];
  for (const { table, col, type } of cols) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`).catch(() => {});
  }

  await pool.query(`UPDATE users SET is_admin = FALSE WHERE username != 'admin'`).catch(() => {});
  await pool.query(`UPDATE users SET is_banned = TRUE WHERE display_name = 'Педик' OR username = 'педик'`).catch(() => {});

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_pm_sender_receiver ON private_messages(sender_id, receiver_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_pm_receiver_sender ON private_messages(receiver_id, sender_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_pm_created ON private_messages(created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
    'CREATE INDEX IF NOT EXISTS idx_banned_ips_ip ON banned_ips(ip_address)',
  ];
  for (const idx of indexes) {
    await pool.query(idx).catch(() => {});
  }
}

module.exports = { pool, initDb };
