const crypto = require('crypto');

const requestId = (req, res, next) => {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.correlationId = req.headers['x-correlation-id'] || req.requestId;
  res.setHeader('X-Request-Id', req.requestId);
  res.setHeader('X-Correlation-Id', req.correlationId);
  next();
};

module.exports = requestId;
