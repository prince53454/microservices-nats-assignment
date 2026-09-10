const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const { notFoundHandler, errorHandler } = require('../../shared/middleware');
const { sendSuccess } = require('../../shared/utils/responses');
const openapiSpec = require('./docs/openapi');
const env = require('./config/env');
const { requestLogger } = require('./middleware/requestLogger');
const { rateLimit } = require('./middleware/rateLimiter');
const routes = require('./routes');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Trust the platform's proxy hops so req.ip reflects the real client
  // (X-Forwarded-For) and rate limits are per-client. Configurable because
  // local/docker-compose has no proxy while Vercel/Railway proxy everything.
  app.set('trust proxy', env.trustProxy);

  // Security headers first, then CORS.
  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    })
  );

  app.use(requestLogger);

  // Apply the rate limit to every /api route.
  app.use('/api', rateLimit);

  // Mount proxy routes BEFORE express.json: the proxies stream request bodies
  // through to the backend services untouched. Parsing here would consume the
  // stream and break POST/PATCH forwarding.
  app.use('/api', routes);

  app.use(express.json({ limit: '100kb' }));

  // Interactive docs at /api/docs, machine-readable spec at /api/docs.json.
  app.get('/api/docs.json', (req, res) => res.json(openapiSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

  // Health endpoints (public, not rate limited).
  app.get('/health', (req, res) => sendSuccess(res, { status: 'ok', service: 'api-gateway' }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
