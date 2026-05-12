const logger = require('./logger');
const { redactEntry } = require('./redact');
const { pool } = require('../db');

const DEFAULT_CONFIG = {
  includeBackendLogs: true,
  includeFrontendErrors: true,
  includeMessageFlow: true,
  includeDeleteFlow: true,
  includeDatabaseStatus: true,
  includeWebSocketStatus: true,
  includeEnvDeploy: true,
  includeAuthEvents: true,
  detailLevel: 'standard',
  timeRange: 'hour',
  format: 'ai-markdown',
  privacyLevel: 'standard',
  aiMode: true,
};

function getTimeSince(timeRange) {
  const now = Date.now();
  const ranges = { '15min': 15 * 60000, 'hour': 3600000, '6hours': 6 * 3600000, '24hours': 86400000 };
  return new Date(now - (ranges[timeRange] || ranges.hour)).toISOString();
}

function getDetailLimit(detailLevel) {
  return { minimal: 20, standard: 50, detailed: 150 }[detailLevel] || 50;
}

async function checkDbStatus() {
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

async function checkDbTables() {
  try {
    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    return result.rows.map(r => r.table_name);
  } catch {
    return null;
  }
}

async function checkRedisStatus(redisClient) {
  if (!redisClient) return { status: 'not_configured' };
  try {
    await redisClient.ping();
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

function getEnvStatus() {
  return {
    DATABASE_URL: !!process.env.DATABASE_URL,
    JWT_SECRET: !!process.env.JWT_SECRET,
    REDIS_URL: !!process.env.REDIS_URL,
    NVIDIA_API_KEY: !!process.env.NVIDIA_API_KEY,
    ADMIN_DIAGNOSTICS_TOKEN: !!process.env.ADMIN_DIAGNOSTICS_TOKEN,
    NODE_ENV: process.env.NODE_ENV || 'not_set',
    FRONTEND_URL: process.env.FRONTEND_URL ? 'set' : 'wildcard',
    PORT: process.env.PORT || '3000',
    corsOpen: !process.env.FRONTEND_URL || process.env.FRONTEND_URL === '*',
    jwtSecretWeak: process.env.JWT_SECRET ? process.env.JWT_SECRET.length < 32 : true,
  };
}

async function generate(config = {}, context = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const since = getTimeSince(cfg.timeRange);
  const limit = getDetailLimit(cfg.detailLevel);
  const filters = { since };

  const health = {
    uptime: Math.floor((Date.now() - logger.startTime) / 1000),
    memoryMB: Math.round(process.memoryUsage.rss ? process.memoryUsage().rss / 1048576 : 0),
    counters: { ...logger.counters },
  };

  const db = cfg.includeDatabaseStatus ? await checkDbStatus() : null;
  const tables = cfg.includeDatabaseStatus ? await checkDbTables() : null;
  const redis = cfg.includeWebSocketStatus ? await checkRedisStatus(context.redisClient) : null;
  const env = cfg.includeEnvDeploy ? getEnvStatus() : null;

  const allLogs = logger.buffer.query(filters, limit * 3).map(redactEntry);

  const backendLogs = cfg.includeBackendLogs
    ? allLogs.filter(e => e.area === 'api' || e.area === 'startup').slice(-limit) : [];
  const frontendErrors = cfg.includeFrontendErrors
    ? allLogs.filter(e => e.area === 'frontend').slice(-limit) : [];
  const messageFlow = cfg.includeMessageFlow
    ? allLogs.filter(e => e.area === 'message-flow').slice(-limit) : [];
  const deleteFlow = cfg.includeDeleteFlow
    ? allLogs.filter(e => e.area === 'delete-flow').slice(-limit) : [];
  const authEvents = cfg.includeAuthEvents
    ? allLogs.filter(e => e.area === 'auth').slice(-limit) : [];
  const dbEvents = cfg.includeDatabaseStatus
    ? allLogs.filter(e => e.area === 'database').slice(-limit) : [];
  const wsEvents = cfg.includeWebSocketStatus
    ? allLogs.filter(e => e.area === 'websocket').slice(-limit) : [];
  const criticals = allLogs.filter(e => e.level === 'critical' || e.level === 'error').slice(-limit);

  if (cfg.format === 'json') {
    return {
      generatedAt: new Date().toISOString(),
      config: cfg,
      health, db, tables, redis, env,
      backendLogs, frontendErrors, messageFlow, deleteFlow,
      authEvents, dbEvents, wsEvents, criticals,
    };
  }

  return generateMarkdown(cfg, {
    health, db, tables, redis, env,
    backendLogs, frontendErrors, messageFlow, deleteFlow,
    authEvents, dbEvents, wsEvents, criticals,
  });
}

function formatEntries(entries) {
  if (!entries.length) return '_No events in selected time range_\n';
  return entries.map(e =>
    `- \`${e.timestamp}\` **${e.level}** [${e.area}] ${e.event}${e.errorMessage ? ': ' + e.errorMessage : ''}${e.requestId ? ' (req:' + e.requestId.slice(0, 8) + ')' : ''}${e.statusCode ? ' status:' + e.statusCode : ''}${e.durationMs ? ' ' + e.durationMs + 'ms' : ''}`
  ).join('\n') + '\n';
}

function generateMarkdown(cfg, data) {
  let md = '# PearNet Diagnostic Bundle\n\n';
  md += `**Generated**: ${new Date().toISOString()}\n`;
  md += `**Time range**: ${cfg.timeRange}\n`;
  md += `**Detail level**: ${cfg.detailLevel}\n\n`;

  md += '## System Status\n\n';
  md += `- Uptime: ${data.health.uptime}s\n`;
  md += `- Memory: ${data.health.memoryMB} MB\n`;
  md += `- Total errors: ${data.health.counters.errors}\n`;
  md += `- Critical errors: ${data.health.counters.criticals}\n`;
  md += `- Message-flow failures: ${data.health.counters.messageFlowFailures}\n`;
  md += `- Delete-flow failures: ${data.health.counters.deleteFlowFailures}\n`;
  md += `- Auth failures: ${data.health.counters.authFailures}\n`;
  md += `- DB failures: ${data.health.counters.dbFailures}\n`;
  md += `- WebSocket failures: ${data.health.counters.wsFailures}\n`;
  md += `- Frontend errors: ${data.health.counters.frontendErrors}\n\n`;

  if (data.db) {
    md += '## Database Status\n\n';
    md += `- Connection: ${data.db.status}${data.db.latencyMs ? ' (' + data.db.latencyMs + 'ms)' : ''}\n`;
    if (data.db.error) md += `- Error: ${data.db.error}\n`;
    if (data.tables) md += `- Tables: ${data.tables.join(', ')}\n`;
    md += '\n';
  }

  if (data.redis) {
    md += '## Redis Status\n\n';
    md += `- Status: ${data.redis.status}\n`;
    if (data.redis.error) md += `- Error: ${data.redis.error}\n`;
    md += '\n';
  }

  if (data.env) {
    md += '## Environment\n\n';
    md += `- DATABASE_URL: ${data.env.DATABASE_URL ? 'set' : 'MISSING'}\n`;
    md += `- JWT_SECRET: ${data.env.JWT_SECRET ? 'set' : 'MISSING'}${data.env.jwtSecretWeak ? ' (WEAK: <32 chars)' : ''}\n`;
    md += `- REDIS_URL: ${data.env.REDIS_URL ? 'set' : 'not set'}\n`;
    md += `- NVIDIA_API_KEY: ${data.env.NVIDIA_API_KEY ? 'set' : 'not set'}\n`;
    md += `- NODE_ENV: ${data.env.NODE_ENV}\n`;
    md += `- CORS: ${data.env.corsOpen ? 'OPEN (wildcard)' : 'restricted'}\n`;
    md += `- FRONTEND_URL: ${data.env.FRONTEND_URL}\n\n`;
  }

  md += '## Critical & Error Logs\n\n';
  md += formatEntries(data.criticals);

  if (cfg.includeBackendLogs) {
    md += '\n## Backend API Logs\n\n';
    md += formatEntries(data.backendLogs);
  }

  if (cfg.includeFrontendErrors) {
    md += '\n## Frontend Errors\n\n';
    md += formatEntries(data.frontendErrors);
  }

  if (cfg.includeMessageFlow) {
    md += '\n## Message Flow Events\n\n';
    md += formatEntries(data.messageFlow);
  }

  if (cfg.includeDeleteFlow) {
    md += '\n## Delete-Message Flow Events\n\n';
    md += formatEntries(data.deleteFlow);
  }

  if (cfg.includeAuthEvents) {
    md += '\n## Auth Events\n\n';
    md += formatEntries(data.authEvents);
  }

  if (cfg.includeDatabaseStatus) {
    md += '\n## Database Events\n\n';
    md += formatEntries(data.dbEvents);
  }

  if (cfg.includeWebSocketStatus) {
    md += '\n## WebSocket Events\n\n';
    md += formatEntries(data.wsEvents);
  }

  if (cfg.aiMode) {
    md += '\n---\n\n## Instruction for External AI\n\n';
    md += 'Analyze this diagnostic bundle only to identify the most likely broken area.\n\n';
    md += 'Rules:\n';
    md += '- Do not suggest fixes.\n';
    md += '- Do not write code.\n';
    md += '- Do not propose architecture changes.\n';
    md += '- Do not recommend libraries.\n';
    md += '- Use only the evidence in this bundle.\n';
    md += '- If evidence is insufficient, say exactly what is missing.\n\n';
    md += 'Output only:\n';
    md += '1. broken_area\n';
    md += '2. evidence\n';
    md += '3. confidence_level\n';
    md += '4. likely_files_or_modules\n';
    md += '5. additional_logs_needed\n';
  }

  return md;
}

module.exports = { generate, checkDbStatus, checkRedisStatus, getEnvStatus, DEFAULT_CONFIG };
