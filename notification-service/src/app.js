const express = require('express');
const helmet = require('helmet');
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const { notFoundHandler, errorHandler, requireInternalApiKey } = require('../../shared/middleware');
const { sendSuccess, sendError } = require('../../shared/utils/responses');
const { ERROR_CODES } = require('../../shared/constants');
const logger = require('./config/logger');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.use((req, res, next) => {
    req.requestId = req.get('x-request-id') || randomUUID();
    res.set('x-request-id', req.requestId);
    req.log = logger.child({ requestId: req.requestId });
    const start = Date.now();
    res.on('finish', () => {
      req.log.info(
        { method: req.method, path: req.originalUrl, statusCode: res.statusCode, durationMs: Date.now() - start },
        'request completed'
      );
    });
    next();
  });

  app.get('/health', (req, res) => sendSuccess(res, { status: 'ok', service: 'notification-service' }));

  app.get('/ready', (req, res) => {
    const mongoReady = mongoose.connection.readyState === 1;
    const natsConnected = req.app.locals.natsStatus === 'connected';
    if (!mongoReady || !natsConnected) {
      return sendError(res, 503, ERROR_CODES.UPSTREAM_UNAVAILABLE, 'Dependencies not ready');
    }
    return sendSuccess(res, { status: 'ready', service: 'notification-service' });
  });

  // Cross-network topology: if INTERNAL_API_KEY is set, only callers presenting
  // x-internal-api-key (the API Gateway) may reach business routes. Health
  // endpoints stay public so platform healthchecks always work. Unset = open
  // (local/docker-compose relies on network isolation instead).
  app.use(requireInternalApiKey);

  app.use('/notifications', require('./routes/notification.routes'));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
