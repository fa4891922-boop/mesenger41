const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const logger = require('../diagnostics/logger');

const MSG_WINDOW_MS = 10000;
const MSG_MAX_PER_WINDOW = 20;
const MSG_AUTOBAN_THRESHOLD = 60;
const EVENT_WINDOW_MS = 5000;
const EVENT_MAX_PER_WINDOW = 50;

function setupSocket(io, onlineUsers, redisClient) {
  logger.info('websocket', 'socket_server_initialized');

  const userContacts = new Map();
  const messageRates = new Map();
  const eventRates = new Map();
  let broadcastTimer = null;

  function checkRate(map, key, windowMs, max) {
    const now = Date.now();
    let entry = map.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      map.set(key, entry);
    }
    entry.count++;
    return entry.count;
  }

  async function autoBanUser(userId) {
    try {
      await pool.query('UPDATE users SET is_banned = TRUE WHERE id = $1', [userId]);
      const ipResult = await pool.query('SELECT last_ip FROM users WHERE id = $1', [userId]);
      const ip = ipResult.rows[0]?.last_ip;
      if (ip) {
        await pool.query(
          'INSERT INTO banned_ips (ip_address, user_id, reason) VALUES ($1, $2, $3)',
          [ip, userId, 'Auto-banned: message spam']
        );
      }
      logger.warn('anti-spam', 'user_auto_banned', { userId });
    } catch (err) {
      logger.error('anti-spam', 'auto_ban_failed', { userId, errorMessage: err.message });
    }
  }

  async function loadUserContacts(userId) {
    try {
      const result = await pool.query(
        `SELECT DISTINCT CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS contact_id
         FROM private_messages
         WHERE (sender_id = $1 OR receiver_id = $1)
           AND deleted_for_sender = FALSE AND deleted_for_receiver = FALSE`,
        [userId]
      );
      const contacts = result.rows.map(r => r.contact_id);
      userContacts.set(userId, contacts);
      return contacts;
    } catch {
      return [];
    }
  }

  function scheduleBroadcast() {
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      for (const [userId, socketId] of onlineUsers) {
        const contacts = userContacts.get(userId) || [];
        const visibleOnline = contacts.filter(cId => onlineUsers.has(cId));
        io.to(socketId).emit('online_users', visibleOnline);
      }
    }, 2000);
  }

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      logger.warn('websocket', 'auth_no_token');
      return next(new Error('No token'));
    }
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      const banned = await pool.query(
        'SELECT is_banned FROM users WHERE id = $1',
        [socket.user.id]
      );
      if (banned.rows[0]?.is_banned) {
        return next(new Error('Banned'));
      }
      logger.debug('websocket', 'auth_success', { userId: socket.user.id });
      next();
    } catch (err) {
      if (err.message === 'Banned') return next(err);
      logger.warn('websocket', 'auth_invalid_token');
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user.id;

    logger.info('websocket', 'client_connected', {
      userId,
      metadata: { onlineCount: onlineUsers.size + 1 },
    });

    onlineUsers.set(userId, socket.id);
    pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [userId]).catch(() => {});
    if (redisClient) {
      redisClient.set(`online:${userId}`, socket.id, { EX: 3600 }).catch(() => {});
    }

    await loadUserContacts(userId);
    scheduleBroadcast();

    socket.use(([event], next) => {
      const eventCount = checkRate(eventRates, userId, EVENT_WINDOW_MS, EVENT_MAX_PER_WINDOW);
      if (eventCount > EVENT_MAX_PER_WINDOW) {
        logger.warn('anti-spam', 'event_rate_exceeded', { userId, metadata: { event } });
        return;
      }
      next();
    });

    socket.on('send_message', async (data) => {
      const msgCount = checkRate(messageRates, userId, MSG_WINDOW_MS, MSG_MAX_PER_WINDOW);

      if (msgCount > MSG_AUTOBAN_THRESHOLD) {
        logger.warn('anti-spam', 'spam_detected_autoban', { userId, metadata: { count: msgCount } });
        await autoBanUser(userId);
        socket.emit('banned');
        socket.disconnect(true);
        onlineUsers.delete(userId);
        return;
      }

      if (msgCount > MSG_MAX_PER_WINDOW) {
        logger.warn('anti-spam', 'message_rate_exceeded', { userId, metadata: { count: msgCount } });
        socket.emit('rate_limited', { retryAfter: MSG_WINDOW_MS });
        return;
      }

      if (!data.content || typeof data.content !== 'string' || data.content.trim().length === 0) return;
      if (data.content.length > 10000) return;
      if (!data.receiverId || !Number.isInteger(data.receiverId)) return;
      const isEncrypted = data.encrypted === true;
      try {
        const result = await pool.query(
          'INSERT INTO private_messages (sender_id, receiver_id, content, encrypted) VALUES ($1, $2, $3, $4) RETURNING *',
          [userId, data.receiverId, isEncrypted ? data.content : data.content.trim(), isEncrypted]
        );
        const message = { ...result.rows[0], sender_name: socket.user.displayName || socket.user.username };

        const senderContacts = userContacts.get(userId) || [];
        if (!senderContacts.includes(data.receiverId)) {
          senderContacts.push(data.receiverId);
          userContacts.set(userId, senderContacts);
        }
        const receiverContacts = userContacts.get(data.receiverId) || [];
        if (!receiverContacts.includes(userId)) {
          receiverContacts.push(userId);
          userContacts.set(data.receiverId, receiverContacts);
        }

        const receiverSocketId = onlineUsers.get(data.receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('receive_message', message);
          scheduleBroadcast();
        }
        socket.emit('receive_message', message);
      } catch (err) {
        logger.error('message-flow', 'ws_message_db_insert_error', {
          userId,
          errorMessage: err.message,
        });
      }
    });

    socket.on('typing', (data) => {
      if (!data.receiverId) return;
      const receiverSocketId = onlineUsers.get(data.receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('user_typing', { userId });
      }
    });

    socket.on('call_offer', (data) => {
      const receiverSocketId = onlineUsers.get(data.to);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('call_incoming', {
          from: userId,
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
      logger.info('websocket', 'client_disconnected', {
        userId,
        metadata: { onlineCount: onlineUsers.size - 1 },
      });
      onlineUsers.delete(userId);
      userContacts.delete(userId);
      messageRates.delete(userId);
      eventRates.delete(userId);
      pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [userId]).catch(() => {});
      if (redisClient) {
        redisClient.del(`online:${userId}`).catch(() => {});
      }
      scheduleBroadcast();
    });
  });
}

module.exports = setupSocket;
