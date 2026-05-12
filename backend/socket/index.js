const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const logger = require('../diagnostics/logger');

function setupSocket(io, onlineUsers, redisClient) {
  logger.info('websocket', 'socket_server_initialized');

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      logger.warn('websocket', 'auth_no_token');
      return next(new Error('No token'));
    }
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      logger.debug('websocket', 'auth_success', { userId: socket.user.id });
      next();
    } catch {
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
    io.emit('online_users', Array.from(onlineUsers.keys()));

    socket.on('send_message', async (data) => {
      logger.info('message-flow', 'ws_send_message_received', {
        userId: socket.user.id,
        metadata: {
          receiverIdHash: logger.hashId(data.receiverId),
          contentLength: data.content?.length,
          receiverOnline: onlineUsers.has(data.receiverId),
        },
      });

      if (!data.content || typeof data.content !== 'string' || data.content.trim().length === 0) return;
      if (data.content.length > 5000) return;
      if (!data.receiverId || !Number.isInteger(data.receiverId)) return;
      try {
        const result = await pool.query(
          'INSERT INTO private_messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *',
          [socket.user.id, data.receiverId, data.content.trim()]
        );
        const message = { ...result.rows[0], sender_name: socket.user.displayName || socket.user.username };

        logger.info('message-flow', 'ws_message_db_insert_success', {
          userId: socket.user.id,
          metadata: { messageId: message.id, contentLength: data.content.trim().length },
        });

        const receiverSocketId = onlineUsers.get(data.receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('receive_message', message);
          logger.info('message-flow', 'ws_message_emit_to_receiver', {
            userId: socket.user.id,
            metadata: { messageId: message.id, receiverOnline: true },
          });
        } else {
          logger.info('message-flow', 'ws_receiver_offline', {
            userId: socket.user.id,
            metadata: { messageId: message.id, receiverOnline: false },
          });
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
      pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [socket.user.id]).catch(() => {});
      if (redisClient) {
        redisClient.del(`online:${socket.user.id}`).catch(() => {});
      }
      io.emit('online_users', Array.from(onlineUsers.keys()));
    });
  });
}

module.exports = setupSocket;
