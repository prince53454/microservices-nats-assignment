const env = require('./config/env');
const logger = require('./config/logger');
const { createApp } = require('./app');

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info({ port: env.port }, 'api-gateway listening');
});

/** Graceful shutdown: stop accepting new requests, then close. */
async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  server.close(() => process.exit(0));
  // Force-exit if connections refuse to drain within 10s.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
