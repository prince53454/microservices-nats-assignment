const mongoose = require('mongoose');
const env = require('./config/env');
const logger = require('./config/logger');
const { createApp } = require('./app');
const { connectNats } = require('./config/jetstream');
const { UserEventPublisher } = require('./events/user.publisher');

let httpServer;
let natsConnection;

async function start() {
  // 1. MongoDB
  await mongoose.connect(env.mongoUri);
  logger.info('MongoDB connected');

  // 2. NATS + JetStream (creates the USER_EVENTS stream if missing)
  const { nc, js } = await connectNats(env, logger);
  natsConnection = nc;

  // 3. HTTP
  const app = createApp();
  app.locals.publisher = new UserEventPublisher(js);

  httpServer = app.listen(env.port, () => {
    logger.info({ port: env.port }, 'user-service listening');
  });

  return httpServer;
}

/** Graceful shutdown: stop HTTP, drain NATS, close Mongo, exit. */
async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  try {
    if (httpServer) await new Promise((r) => httpServer.close(r)); // 1. stop accepting requests
    if (natsConnection) await natsConnection.drain();              // 2. drain NATS
    await mongoose.connection.close();                             // 3. close Mongo
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
