const logger = require('../diagnostics/logger');

const SENSITIVE_ROUTES = new Set(['/api/login', '/api/register']);

const apiLogger = (req, res, next) => {
  const start = Date.now();

  const originalEnd = res.end;
  res.end = function (...args) {
    const durationMs = Date.now() - start;
    const meta = {
      requestId: req.requestId,
      route: req.originalUrl?.split('?')[0],
      method: req.method,
      statusCode: res.statusCode,
      durationMs,
      userId: req.user?.id,
    };

    if (SENSITIVE_ROUTES.has(meta.route)) {
      meta.metadata = { bodyKeys: req.body ? Object.keys(req.body) : [] };
    } else if (req.body?.content) {
      meta.metadata = { contentLength: req.body.content.length };
    }

    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger.log(level, 'api', 'request_completed', meta);

    originalEnd.apply(this, args);
  };

  next();
};

module.exports = apiLogger;
