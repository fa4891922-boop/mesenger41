const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const logger = require('../diagnostics/logger');

function setupSocket(io, onlineUsers, redisClient) {
  logger.info('websocket', 'socket_server_initialized');

  const userContacts = new Map();

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

  function broadcastOnlineStatus() {
    for (const [userId, socketId] of onlineUsers) {
      const contacts = userContacts.get(userId) || [];
      const visibleOnline = contacts.filter(cId => onlineUsers.has(cId));
      io.to(socketId).emit('online_users', visibleOnline);
    }
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
    logger.info('websocket', 'client_connected', {
      userId: socket.user.id,
      metadata: { onlineCount: onlineUsers.size + 1 },
    });

    onlineUsers.set(socket.user.id, socket.id);
    pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [socket.user.id]).catch(() => {});
    if (redisClient) {
      redisClient.set(`online:${socket.user.id}`, socket.id, { EX: 3600 }).catch(() => {});
    }

    await loadUserContacts(socket.user.id);
    broadcastOnlineStatus();

    socket.on('send_message', async (data) => {
      logger.info('message-flow', 'ws_send_message_received', {
        userId: socket.user.id,
      });

      if (!data.content || typeof data.content !== 'string' || data.content.trim().length === 0) return;
      if (data.content.length > 10000) return;
      if (!data.receiverId || !Number.isInteger(data.receiverId)) return;
      const isEncrypted = data.encrypted === true;
      try {
        const result = await pool.query(
          'INSERT INTO private_messages (sender_id, receiver_id, content, encrypted) VALUES ($1, $2, $3, $4) RETURNING *',
          [socket.user.id, data.receiverId, isEncrypted ? data.content : data.content.trim(), isEncrypted]
        );
        const message = { ...result.rows[0], sender_name: socket.user.displayName || socket.user.username };

        logger.info('message-flow', 'ws_message_db_insert_success', {
          userId: socket.user.id,
          metadata: { messageId: message.id },
        });

        const senderContacts = userContacts.get(socket.user.id) || [];
        if (!senderContacts.includes(data.receiverId)) {
          senderContacts.push(data.receiverId);
          userContacts.set(socket.user.id, senderContacts);
        }
        const receiverContacts = userContacts.get(data.receiverId) || [];
        if (!receiverContacts.includes(socket.user.id)) {
          receiverContacts.push(socket.user.id);
          userContacts.set(data.receiverId, receiverContacts);
        }

        const receiverSocketId = onlineUsers.get(data.receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('receive_message', message);
          broadcastOnlineStatus();
        }
        socket.emit('receive_message', message);
      } catch (err) {
        logger.error('message-flow', 'ws_message_db_insert_error', {
          userId: socket.user.id,
          errorMessage: err.message,
        });
        console.error('send_message error:', err);
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
      logger.info('websocket', 'client_disconnected', {
        userId: socket.user.id,
        metadata: { onlineCount: onlineUsers.size - 1 },
      });
      onlineUsers.delete(socket.user.id);
      userContacts.delete(socket.user.id);
      pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [socket.user.id]).catch(() => {});
      if (redisClient) {
        redisClient.del(`online:${socket.user.id}`).catch(() => {});
      }
      broadcastOnlineStatus();
    });
  });
}

module.exports = setupSocket;
