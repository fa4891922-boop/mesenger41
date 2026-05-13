require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL environment variable is not set');
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set');
  process.exit(1);
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('redis');
const { initDb } = require('./db');
const setupSocket = require('./socket');
const logger = require('./diagnostics/logger');
const requestId = require('./middleware/requestId');
const apiLogger = require('./middleware/apiLogger');

const MOBILE_ORIGINS = ['https://localhost', 'http://localhost', 'capacitor://localhost', 'ionic://localhost'];
const configuredOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([...configuredOrigins, ...MOBILE_ORIGINS]);
const corsOrigin = configuredOrigins.length === 0 || configuredOrigins.includes('*')
  ? '*'
  : (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error(`CORS origin not allowed: ${origin}`));
    };

const app = express();
app.use(helmet());
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '50kb' }));
app.use(requestId);
app.use(apiLogger);

app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
  },
});

const onlineUsers = new Map();

let redisClient;
if (process.env.REDIS_URL) {
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', (err) => {
    logger.error('redis', 'connection_error', { errorMessage: err.message });
  });
  redisClient.connect().then(() => {
    logger.info('redis', 'connected');
  }).catch((err) => {
    logger.error('redis', 'connect_failed', { errorMessage: err.message });
  });
}

app.get('/', (req, res) => res.send('PearNet API is running!'));
app.use('/api', require('./routes/auth')(redisClient));
app.use('/api', require('./routes/users'));
app.use('/api', require('./routes/conversations')(io, onlineUsers));
app.use('/api', require('./routes/messages')(io, onlineUsers));
app.use('/api', require('./routes/turn'));
app.use('/api', require('./routes/keys'));
app.use('/api', require('./routes/diagnostics')(io, onlineUsers, redisClient));

setupSocket(io, onlineUsers, redisClient);

logger.info('startup', 'server_initializing', {
  metadata: {
    env: process.env.NODE_ENV || 'not_set',
    corsOpen: corsOrigin === '*',
    corsOrigins: corsOrigin === '*' ? ['*'] : [...allowedOrigins],
    redisConfigured: !!process.env.REDIS_URL,
    nvidiaConfigured: !!process.env.NVIDIA_API_KEY,
    adminTokenConfigured: !!process.env.ADMIN_DIAGNOSTICS_TOKEN,
  },
});

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => {
    logger.info('startup', 'database_initialized');
    server.listen(PORT, () => {
      logger.info('startup', 'server_started', { metadata: { port: PORT } });
      console.log(`PearNet server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    logger.critical('startup', 'database_init_failed', { errorMessage: err.message });
    console.error('FATAL: Database initialization failed:', err.message);
    process.exit(1);
  });
