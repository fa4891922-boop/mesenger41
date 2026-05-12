const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../diagnostics/logger');
const { redactEntry } = require('../diagnostics/redact');
const bundle = require('../diagnostics/bundle');
const adminAuth = require('../middleware/adminAuth');
const authenticate = require('../middleware/auth');

module.exports = (io, onlineUsers, redisClient) => {
  const router = express.Router();

  const frontendErrorLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Too many error reports' },
  });

  router.get('/admin/diagnostics/health', adminAuth, async (req, res) => {
    try {
      const db = await bundle.checkDbStatus();
      const redis = await bundle.checkRedisStatus(redisClient);
      const env = bundle.getEnvStatus();
      const socketCount = io ? io.engine?.clientsCount || 0 : 0;

      res.json({
        requestId: req.requestId,
        backend: { status: 'ok', uptime: Math.floor((Date.now() - logger.startTime) / 1000) },
        database: db,
        websocket: { status: 'ok', connectedClients: socketCount, onlineUsers: onlineUsers.size },
        redis,
        environment: env,
        nvidia: { available: !!process.env.NVIDIA_API_KEY },
        memory: {
          rss: Math.round(process.memoryUsage().rss / 1048576),
          heap: Math.round(process.memoryUsage().heapUsed / 1048576),
        },
        counters: { ...logger.counters },
        logBufferSize: logger.buffer.size(),
      });
    } catch (err) {
      res.status(500).json({ error: 'Health check failed', requestId: req.requestId });
    }
  });

  router.get('/admin/diagnostics/logs', adminAuth, (req, res) => {
    try {
      const { level, area, event, requestId: reqId, since, until } = req.query;
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);
      const filters = {};
      if (level) filters.level = level;
      if (area) filters.area = area;
      if (event) filters.event = event;
      if (reqId) filters.requestId = reqId;
      if (since) filters.since = since;
      if (until) filters.until = until;

      const entries = logger.buffer.query(filters, limit).map(redactEntry);
      res.json({ requestId: req.requestId, count: entries.length, logs: entries });
    } catch (err) {
      res.status(500).json({ error: 'Failed to query logs', requestId: req.requestId });
    }
  });

  router.get('/admin/diagnostics/bundle', adminAuth, async (req, res) => {
    try {
      const config = {};
      if (req.query.config) {
        try { Object.assign(config, JSON.parse(req.query.config)); } catch {}
      }
      for (const key of ['includeBackendLogs', 'includeFrontendErrors', 'includeMessageFlow',
        'includeDeleteFlow', 'includeDatabaseStatus', 'includeWebSocketStatus',
        'includeEnvDeploy', 'includeAuthEvents', 'aiMode']) {
        if (req.query[key] !== undefined) config[key] = req.query[key] === 'true';
      }
      if (req.query.detailLevel) config.detailLevel = req.query.detailLevel;
      if (req.query.timeRange) config.timeRange = req.query.timeRange;
      if (req.query.format) config.format = req.query.format;
      if (req.query.privacyLevel) config.privacyLevel = req.query.privacyLevel;

      const result = await bundle.generate(config, { redisClient });
      const isJson = config.format === 'json';
      res.setHeader('Content-Type', isJson ? 'application/json' : 'text/plain; charset=utf-8');
      res.send(isJson ? JSON.stringify(result, null, 2) : result);
    } catch (err) {
      console.error('Bundle generation error:', err);
      res.status(500).json({ error: 'Failed to generate bundle', requestId: req.requestId });
    }
  });

  router.post('/admin/diagnostics/frontend-error', authenticate, frontendErrorLimiter, (req, res) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Invalid payload' });
      }
      const payloadStr = JSON.stringify(body);
      if (payloadStr.length > 10000) {
        return res.status(413).json({ error: 'Payload too large' });
      }

      const allowedFields = ['component', 'action', 'screen', 'errorMessage', 'stack',
        'browser', 'appVersion', 'metadata', 'timestamp'];
      const safe = {};
      for (const key of allowedFields) {
        if (body[key] !== undefined) {
          safe[key] = typeof body[key] === 'string' ? body[key].slice(0, 2000) : body[key];
        }
      }

      logger.log('error', 'frontend', 'frontend_error_report', {
        requestId: req.requestId,
        userId: req.user?.id,
        message: safe.errorMessage?.slice(0, 500),
        metadata: {
          component: safe.component,
          action: safe.action,
          screen: safe.screen,
          browser: safe.browser,
          appVersion: safe.appVersion,
          stack: safe.stack?.slice(0, 2000),
        },
      });

      res.json({ received: true, requestId: req.requestId });
    } catch (err) {
      res.status(500).json({ error: 'Failed to process error report', requestId: req.requestId });
    }
  });

  router.post('/admin/diagnostics/ai-analyze', adminAuth, async (req, res) => {
    if (!process.env.NVIDIA_API_KEY) {
      return res.status(503).json({
        error: 'AI Analyze unavailable: NVIDIA_API_KEY not configured',
        requestId: req.requestId,
      });
    }

    try {
      const config = req.body?.config || {};
      config.format = 'ai-markdown';
      config.aiMode = true;
      const diagnosticBundle = await bundle.generate(config, { redisClient });

      const prompt = `You are a failure-localization diagnostic model for PearNet Messenger.

Analyze the provided diagnostic bundle only to identify where the system is most likely broken.

Rules:
- Do not suggest fixes.
- Do not write code.
- Do not propose architecture changes.
- Do not recommend libraries.
- Do not add product advice.
- Do not make assumptions beyond the evidence.
- Use only the diagnostic bundle.
- If evidence is insufficient, say what additional logs are needed.

Output only:
1. broken_area
2. evidence
3. confidence_level
4. likely_files_or_modules
5. additional_logs_needed

If evidence is insufficient, say so directly.

Do not output implementation steps.

---

${diagnosticBundle}`;

      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'meta/llama-3.1-70b-instruct',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2000,
          temperature: 0.2,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown');
        logger.error('diagnostics', 'nvidia_api_error', {
          requestId: req.requestId,
          statusCode: response.status,
          errorMessage: errorText.slice(0, 500),
        });
        return res.status(502).json({ error: 'NVIDIA API request failed', requestId: req.requestId });
      }

      const data = await response.json();
      const analysis = data.choices?.[0]?.message?.content || 'No analysis returned';
      res.json({ analysis, requestId: req.requestId });
    } catch (err) {
      logger.error('diagnostics', 'ai_analyze_error', {
        requestId: req.requestId,
        errorMessage: err.message,
      });
      res.status(500).json({ error: 'AI analysis failed', requestId: req.requestId });
    }
  });

  return router;
};
