const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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

  const cols = [
    { table: 'private_messages', col: 'edited_at', type: 'TIMESTAMP' },
    { table: 'private_messages', col: 'deleted_for_sender', type: 'BOOLEAN DEFAULT FALSE' },
    { table: 'private_messages', col: 'deleted_for_receiver', type: 'BOOLEAN DEFAULT FALSE' },
    { table: 'users', col: 'last_seen', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' }
  ];
  for (const { table, col, type } of cols) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`).catch(() => {});
  }
}

module.exports = { pool, initDb };
