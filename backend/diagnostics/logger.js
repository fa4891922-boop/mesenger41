const crypto = require('crypto');

class RingBuffer {
  constructor(maxSize = 2000) {
    this.buffer = [];
    this.maxSize = maxSize;
  }

  push(entry) {
    try {
      this.buffer.push(entry);
      if (this.buffer.length > this.maxSize) {
        this.buffer.shift();
      }
    } catch { /* never crash */ }
  }

  query(filters = {}, limit = 200) {
    try {
      let results = this.buffer;
      if (filters.level) results = results.filter(e => e.level === filters.level);
      if (filters.area) results = results.filter(e => e.area === filters.area);
      if (filters.event) results = results.filter(e => e.event && e.event.includes(filters.event));
      if (filters.requestId) results = results.filter(e => e.requestId === filters.requestId);
      if (filters.since) {
        const since = new Date(filters.since).getTime();
        results = results.filter(e => new Date(e.timestamp).getTime() >= since);
      }
      if (filters.until) {
        const until = new Date(filters.until).getTime();
        results = results.filter(e => new Date(e.timestamp).getTime() <= until);
      }
      return results.slice(-Math.min(limit, 500));
    } catch {
      return [];
    }
  }

  getAll() {
    return [...this.buffer];
  }

  size() {
    return this.buffer.length;
  }

  clear() {
    this.buffer = [];
  }
}

const counters = {
  errors: 0,
  criticals: 0,
  messageFlowFailures: 0,
  deleteFlowFailures: 0,
  authFailures: 0,
  dbFailures: 0,
  wsFailures: 0,
  frontendErrors: 0,
};

const buffer = new RingBuffer(2000);
const startTime = Date.now();

function hashId(id) {
  if (id === undefined || id === null) return null;
  return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 12);
}

function log(level, area, event, data = {}) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      area,
      event,
      message: data.message || null,
      requestId: data.requestId || null,
      correlationId: data.correlationId || null,
      userIdHash: data.userId ? hashId(data.userId) : (data.userIdHash || null),
      route: data.route || null,
      method: data.method || null,
      statusCode: data.statusCode || null,
      durationMs: data.durationMs || null,
      errorName: data.errorName || null,
      errorMessage: data.errorMessage || null,
      stack: data.stack || null,
      metadata: data.metadata || null,
    };

    buffer.push(entry);

    if (level === 'error') counters.errors++;
    if (level === 'critical') counters.criticals++;
    if (area === 'message-flow' && level === 'error') counters.messageFlowFailures++;
    if (area === 'delete-flow' && level === 'error') counters.deleteFlowFailures++;
    if (area === 'auth' && event?.includes('fail')) counters.authFailures++;
    if (area === 'database' && level === 'error') counters.dbFailures++;
    if (area === 'websocket' && level === 'error') counters.wsFailures++;
    if (area === 'frontend') counters.frontendErrors++;
  } catch { /* never crash the app */ }
}

module.exports = {
  log,
  debug: (area, event, data) => log('debug', area, event, data),
  info: (area, event, data) => log('info', area, event, data),
  warn: (area, event, data) => log('warn', area, event, data),
  error: (area, event, data) => log('error', area, event, data),
  critical: (area, event, data) => log('critical', area, event, data),
  buffer,
  counters,
  hashId,
  startTime,
};
