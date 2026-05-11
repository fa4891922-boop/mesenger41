const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const { createClient } = require('redis');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'pearnet-secret-2026-change-me';

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST']
  }
});

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

initDb().catch(console.error);

let redisClient;
if (process.env.REDIS_URL) {
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', (err) => console.log('Redis Client Error', err));
  redisClient.connect().catch(console.error);
}

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

app.get('/', (req, res) => res.send('PearNet API is running!'));

app.post('/api/register', async (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, username, display_name',
      [username.toLowerCase().trim(), hash, displayName || username]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, username: user.username, displayName: user.display_name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Username already taken' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase().trim()]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, username: user.username, displayName: user.display_name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, display_name FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', authenticate, async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/conversations', authenticate, async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages/:userId', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.*, u.display_name as sender_name
       FROM private_messages m
       JOIN users u ON m.sender_id = u.id
       WHERE ((m.sender_id = $1 AND m.receiver_id = $2 AND m.deleted_for_sender = FALSE)
          OR (m.sender_id = $2 AND m.receiver_id = $1 AND m.deleted_for_receiver = FALSE))
       ORDER BY m.created_at ASC
       LIMIT 200`,
      [req.user.id, parseInt(req.params.userId)]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/messages/:messageId', authenticate, async (req, res) => {
  const { forEveryone } = req.body || {};
  const messageId = parseInt(req.params.messageId);
  try {
    const msg = await pool.query('SELECT * FROM private_messages WHERE id = $1', [messageId]);
    if (!msg.rows[0]) return res.status(404).json({ error: 'Message not found' });
    const m = msg.rows[0];
    if (m.sender_id !== req.user.id && m.receiver_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (forEveryone && m.sender_id === req.user.id) {
      await pool.query('DELETE FROM private_messages WHERE id = $1', [messageId]);
      const otherId = m.receiver_id;
      const receiverSocketId = onlineUsers.get(otherId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('message_deleted', { messageId, forEveryone: true });
      }
    } else {
      const col = m.sender_id === req.user.id ? 'deleted_for_sender' : 'deleted_for_receiver';
      await pool.query(`UPDATE private_messages SET ${col} = TRUE WHERE id = $1`, [messageId]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/messages/:messageId', authenticate, async (req, res) => {
  const { content } = req.body;
  const messageId = parseInt(req.params.messageId);
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
  try {
    const msg = await pool.query('SELECT * FROM private_messages WHERE id = $1 AND sender_id = $2', [messageId, req.user.id]);
    if (!msg.rows[0]) return res.status(404).json({ error: 'Message not found or not yours' });

    const result = await pool.query(
      'UPDATE private_messages SET content = $1, edited_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [content.trim(), messageId]
    );
    const updated = result.rows[0];
    const otherId = updated.receiver_id;
    const receiverSocketId = onlineUsers.get(otherId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('message_edited', updated);
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/conversations/:userId', authenticate, async (req, res) => {
  const otherId = parseInt(req.params.userId);
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
    res.status(500).json({ error: err.message });
  }
});

const onlineUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('No token'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  onlineUsers.set(socket.user.id, socket.id);
  pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [socket.user.id]).catch(() => {});
  io.emit('online_users', Array.from(onlineUsers.keys()));

  socket.on('send_message', async (data) => {
    try {
      const result = await pool.query(
        'INSERT INTO private_messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *',
        [socket.user.id, data.receiverId, data.content]
      );
      const message = { ...result.rows[0], sender_name: socket.user.displayName || socket.user.username };

      const receiverSocketId = onlineUsers.get(data.receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('receive_message', message);
      }
      socket.emit('receive_message', message);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('typing', (data) => {
    const receiverSocketId = onlineUsers.get(data.receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('user_typing', { userId: socket.user.id });
    }
  });

  socket.on('call_offer', (data) => {
    const receiverSocketId = onlineUsers.get(data.to);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('call_incoming', {
        from: socket.user.id,
        fromName: socket.user.displayName || socket.user.username,
        offer: data.offer,
        callType: data.callType,
      });
    } else {
      socket.emit('call_rejected', { reason: 'offline' });
    }
  });

  socket.on('call_answer', (data) => {
    const callerSocketId = onlineUsers.get(data.to);
    if (callerSocketId) {
      io.to(callerSocketId).emit('call_answered', { answer: data.answer });
    }
  });

  socket.on('call_ice', (data) => {
    const targetSocketId = onlineUsers.get(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call_ice', { candidate: data.candidate });
    }
  });

  socket.on('call_end', (data) => {
    const targetSocketId = onlineUsers.get(data.to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call_ended');
    }
  });

  socket.on('call_reject', (data) => {
    const callerSocketId = onlineUsers.get(data.to);
    if (callerSocketId) {
      io.to(callerSocketId).emit('call_rejected', { reason: 'declined' });
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.user.id);
    pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [socket.user.id]).catch(() => {});
    io.emit('online_users', Array.from(onlineUsers.keys()));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`PearNet server running on port ${PORT}`);
});
