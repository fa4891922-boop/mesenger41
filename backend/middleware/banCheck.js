const { pool } = require('../db');
const logger = require('../diagnostics/logger');

const ipCache = new Map();
const CACHE_TTL = 60000;
let lastCacheRefresh = 0;

async function refreshCache() {
  const now = Date.now();
  if (now - lastCacheRefresh < CACHE_TTL) return;
  lastCacheRefresh = now;
  try {
    const result = await pool.query('SELECT ip_address FROM banned_ips');
    ipCache.clear();
    for (const row of result.rows) {
      ipCache.set(row.ip_address, true);
    }
  } catch {
    // keep existing cache on error
  }
}

function isIpBanned(ip) {
  return ipCache.has(ip);
}

const banCheck = async (req, res, next) => {
  await refreshCache();
  if (isIpBanned(req.ip)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
};

banCheck.isIpBanned = isIpBanned;
banCheck.refreshCache = refreshCache;

module.exports = banCheck;
