const mongoose = require('mongoose');
const { Events } = require('nats');
const env = require('./config/env');
const logger = require('./config/logger');
const { createApp } = require('./app');
const { connectNats } = require('./config/jetstream');
const { UserEventConsumer } = require('./events/consumer');

let httpServer;
let natsConnection;
let consumer;

async function start() {
  // 1. MongoDB
  await mongoose.connect(env.mongoUri);
  logger.info('MongoDB connected');

  // 2. NATS: reuse the shared stream provisioning (idempotent), then consume.
  const { nc, js, jsm } = await connectNats(env, logger);
  natsConnection = nc;

  consumer = new UserEventConsumer(jsm, js, env.maxDeliveries);
  await consumer.start();

  // 3. HTTP (read + status endpoints)
  const app = createApp();
  app.locals.natsStatus = 'connected';

  // v2 client: connection lifecycle arrives on the status() async iterator.
  (async () => {
    for await (const s of nc.status()) {
      if (s.type === Events.Disconnect) {
        app.locals.natsStatus = 'disconnected';
        logger.warn({ servers: s.data }, 'NATS disconnected');
      } else if (s.type === Events.Reconnect) {
        app.locals.natsStatus = 'connected';
        logger.info({ server: s.data }, 'NATS reconnected');
      }
    }
  })();

  httpServer = app.listen(env.port, () => {
    logger.info({ port: env.port }, 'notification-service listening');
  });

  return httpServer;
}

/** Graceful shutdown: stop HTTP, stop consuming, drain NATS, close Mongo. */
async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  try {
    if (httpServer) await new Promise((r) => httpServer.close(r)); // 1. stop HTTP
    if (consumer) await consumer.stop();                           // 2. stop consuming
    if (natsConnection) await natsConnection.drain();              // 3. drain NATS
    await mongoose.connection.close();                             // 4. close Mongo
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
