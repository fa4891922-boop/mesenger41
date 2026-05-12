const SENSITIVE_KEYS = new Set([
  'password', 'password_hash', 'token', 'jwt', 'cookie', 'cookies',
  'authorization', 'auth', 'secret', 'api_key', 'apikey', 'api-key',
  'database_url', 'jwt_secret', 'nvidia_api_key', 'admin_diagnostics_token',
  'redis_url', 'connection_string', 'access_token', 'refresh_token',
  'session_id', 'sessionid', 'content',
]);

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g,
  /nvapi-[A-Za-z0-9]+/g,
  /postgres(ql)?:\/\/[^\s]+/gi,
  /redis:\/\/[^\s]+/gi,
  /mongodb(\+srv)?:\/\/[^\s]+/gi,
  /password=[^\s&]+/gi,
  /secret=[^\s&]+/gi,
];

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(String(key).toLowerCase().replace(/[-_\s]/g, '_'));
}

function redactValue(key, value) {
  if (isSensitiveKey(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactText(value);
  return value;
}

function redactText(text) {
  if (typeof text !== 'string') return text;
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

function redactObject(obj, depth = 0) {
  if (depth > 10) return '[MAX_DEPTH]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return redactText(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => redactObject(item, depth + 1));

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactObject(value, depth + 1);
    } else {
      result[key] = redactValue(key, value);
    }
  }
  return result;
}

function redactEntry(entry) {
  try {
    const safe = { ...entry };
    if (safe.stack) safe.stack = redactText(safe.stack);
    if (safe.errorMessage) safe.errorMessage = redactText(safe.errorMessage);
    if (safe.message) safe.message = redactText(safe.message);
    if (safe.metadata) safe.metadata = redactObject(safe.metadata);
    return safe;
  } catch {
    return { timestamp: entry.timestamp, level: entry.level, area: entry.area, event: '[REDACT_ERROR]' };
  }
}

module.exports = { redactValue, redactText, redactObject, redactEntry, isSensitiveKey };
