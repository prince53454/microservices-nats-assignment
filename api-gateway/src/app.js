const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const { notFoundHandler, errorHandler } = require('../../shared/middleware');
const { sendSuccess, sendError } = require('../../shared/utils/responses');
const { ERROR_CODES } = require('../../shared/constants');
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

  if (env.missingEnv.length === 0) {
    // Mount proxy routes BEFORE express.json: the proxies stream request bodies
    // through to the backend services untouched. Parsing here would consume the
    // stream and break POST/PATCH forwarding.
    app.use('/api', routes);
  } else {
    // Degraded mode: boot succeeded but required env vars are missing. Instead
    // of crashing (which a visitor sees only as FUNCTION_INVOCATION_FAILED),
    // every API call gets a 503 naming the missing variables.
    app.use('/api', (req, res) => {
      sendError(
        res,
        503,
        ERROR_CODES.GATEWAY_NOT_CONFIGURED,
        'Gateway is not configured: required environment variables are missing. See /healthz/env.',
        env.missingEnv.map((name) => ({ field: name, message: `${name} is not set` }))
      );
    });
  }

  app.use(express.json({ limit: '100kb' }));

  // Interactive docs at /api/docs, machine-readable spec at /api/docs.json.
  app.get('/api/docs.json', (req, res) => res.json(openapiSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

  // Health endpoints (public, not rate limited).
  app.get('/health', (req, res) => sendSuccess(res, { status: 'ok', service: 'api-gateway' }));

  // Deployment diagnostics: reports ONLY which required variables are missing
  // (never their values, and never the optional ones), so a failed cloud
  // deployment can be fixed from the browser alone.
  app.get('/healthz/env', (req, res) =>
    sendSuccess(res, {
      status: env.missingEnv.length === 0 ? 'ok' : 'degraded',
      service: 'api-gateway',
      missingEnv: env.missingEnv,
    }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
