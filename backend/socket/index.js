const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const logger = require('../diagnostics/logger');
const { isIpBanned, refreshCache } = require('../middleware/banCheck');

const MSG_WINDOW_MS = 10000;
const MSG_MAX_PER_WINDOW = 15;
const MSG_AUTOBAN_THRESHOLD = 40;
const EVENT_WINDOW_MS = 5000;
const EVENT_MAX_PER_WINDOW = 30;
const CONN_PER_IP_WINDOW_MS = 60000;
const CONN_PER_IP_MAX = 5;
const DUPLICATE_WINDOW_MS = 3000;
const MAX_TOTAL_CONNECTIONS = 200;

function setupSocket(io, onlineUsers, redisClient) {
  logger.info('websocket', 'socket_server_initialized');

  const userContacts = new Map();
  const messageRates = new Map();
  const eventRates = new Map();
  const connRatesPerIp = new Map();
  const lastMessages = new Map();
  const userSockets = new Map();
  let broadcastTimer = null;

  io.engine.on('connection_error', () => {});

  function checkRate(map, key, windowMs) {
    const now = Date.now();
    let entry = map.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      map.set(key, entry);
    }
    entry.count++;
    return entry.count;
  }

  function isDuplicate(userId, content) {
    const now = Date.now();
    const key = `${userId}`;
    const last = lastMessages.get(key);
    if (last && last.content === content && now - last.time < DUPLICATE_WINDOW_MS) {
      return true;
    }
    lastMessages.set(key, { content, time: now });
    return false;
  }

  async function autoBanUser(userId, reason) {
    try {
      await pool.query('UPDATE users SET is_banned = TRUE WHERE id = $1', [userId]);
      const ipResult = await pool.query('SELECT last_ip FROM users WHERE id = $1', [userId]);
      const ip = ipResult.rows[0]?.last_ip;
      if (ip) {
        await pool.query(
          'INSERT INTO banned_ips (ip_address, user_id, reason) VALUES ($1, $2, $3)',
          [ip, userId, reason]
        );
        await refreshCache();
      }
      logger.warn('anti-spam', 'user_auto_banned', { userId, metadata: { reason } });
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
    const ip = socket.handshake.address;

    await refreshCache();
    if (isIpBanned(ip)) {
      logger.warn('anti-spam', 'banned_ip_socket_rejected', { metadata: { ip } });
      return next(new Error('Access denied'));
    }

    if (io.engine.clientsCount >= MAX_TOTAL_CONNECTIONS) {
      logger.warn('anti-spam', 'max_connections_reached');
      return next(new Error('Server full'));
    }

    const connCount = checkRate(connRatesPerIp, ip, CONN_PER_IP_WINDOW_MS);
    if (connCount > CONN_PER_IP_MAX) {
      logger.warn('anti-spam', 'connection_rate_exceeded', { metadata: { ip, count: connCount } });
      return next(new Error('Too many connections'));
    }

    const token = socket.handshake.auth.token;
    if (!token) {
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
      next();
    } catch (err) {
      if (err.message === 'Banned') return next(err);
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user.id;

    const existingSocketId = userSockets.get(userId);
    if (existingSocketId) {
      const existingSocket = io.sockets.sockets.get(existingSocketId);
      if (existingSocket) {
        existingSocket.disconnect(true);
      }
    }
    userSockets.set(userId, socket.id);

    onlineUsers.set(userId, socket.id);
    pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP, last_ip = $2 WHERE id = $1',
      [userId, socket.handshake.address]).catch(() => {});
    if (redisClient) {
      redisClient.set(`online:${userId}`, socket.id, { EX: 3600 }).catch(() => {});
    }

    await loadUserContacts(userId);
    scheduleBroadcast();

    socket.use(([event], next) => {
      const eventCount = checkRate(eventRates, userId, EVENT_WINDOW_MS);
      if (eventCount > EVENT_MAX_PER_WINDOW * 3) {
        autoBanUser(userId, 'Auto-banned: event flood');
        socket.emit('banned');
        socket.disconnect(true);
        return;
      }
      if (eventCount > EVENT_MAX_PER_WINDOW) {
        return;
      }
      next();
    });

    socket.on('send_message', async (data) => {
      const msgCount = checkRate(messageRates, userId, MSG_WINDOW_MS);

      if (msgCount > MSG_AUTOBAN_THRESHOLD) {
        await autoBanUser(userId, 'Auto-banned: message spam');
        socket.emit('banned');
        socket.disconnect(true);
        onlineUsers.delete(userId);
        userSockets.delete(userId);
        return;
      }

      if (msgCount > MSG_MAX_PER_WINDOW) {
        socket.emit('rate_limited', { retryAfter: MSG_WINDOW_MS });
        return;
      }

      if (!data || typeof data !== 'object') return;
      if (!data.content || typeof data.content !== 'string') return;
      if (data.content.length === 0 || data.content.length > 5000) return;
      if (!data.receiverId || typeof data.receiverId !== 'number' || data.receiverId < 1) return;
      if (data.receiverId === userId) return;

      const contentToStore = data.encrypted === true ? data.content : data.content.trim();
      if (contentToStore.length === 0) return;

      if (isDuplicate(userId, contentToStore)) {
        return;
      }

      try {
        const result = await pool.query(
          'INSERT INTO private_messages (sender_id, receiver_id, content, encrypted) VALUES ($1, $2, $3, $4) RETURNING *',
          [userId, data.receiverId, contentToStore, data.encrypted === true]
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
      if (!data || !data.receiverId) return;
      const receiverSocketId = onlineUsers.get(data.receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('user_typing', { userId });
      }
    });

    socket.on('call_offer', (data) => {
      if (!data || !data.to) return;
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
      if (!data || !data.to) return;
      const callerSocketId = onlineUsers.get(data.to);
      if (callerSocketId) {
        io.to(callerSocketId).emit('call_answered', { answer: data.answer });
      }
    });

    socket.on('call_ice', (data) => {
      if (!data || !data.to) return;
      const targetSocketId = onlineUsers.get(data.to);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call_ice', { candidate: data.candidate });
      }
    });

    socket.on('call_end', (data) => {
      if (!data || !data.to) return;
      const targetSocketId = onlineUsers.get(data.to);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call_ended');
      }
    });

    socket.on('call_reject', (data) => {
      if (!data || !data.to) return;
      const callerSocketId = onlineUsers.get(data.to);
      if (callerSocketId) {
        io.to(callerSocketId).emit('call_rejected', { reason: 'declined' });
      }
    });

    socket.on('disconnect', () => {
      if (userSockets.get(userId) === socket.id) {
        userSockets.delete(userId);
        onlineUsers.delete(userId);
      }
      userContacts.delete(userId);
      messageRates.delete(userId);
      eventRates.delete(userId);
      lastMessages.delete(`${userId}`);
      pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [userId]).catch(() => {});
      if (redisClient) {
        redisClient.del(`online:${userId}`).catch(() => {});
      }
      scheduleBroadcast();
    });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of connRatesPerIp) {
      if (now - entry.start > CONN_PER_IP_WINDOW_MS * 2) connRatesPerIp.delete(key);
    }
  }, 120000);
}

module.exports = setupSocket;
