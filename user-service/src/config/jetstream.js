const { connect } = require('nats');
const logger = require('./logger');
const { USER_EVENTS_STREAM } = require('../../../shared/constants');

/**
 * Connects to NATS and ensures the USER_EVENTS stream exists.
 * Every service runs this so the topology is self-healing on fresh deploys.
 */
async function connectNats(env, log = logger) {
  const nc = await connect({
    servers: env.natsUrl,
    user: env.natsUser,
    pass: env.natsPassword,
    maxReconnectAttempts: -1, // retry forever
    reconnectTimeWait: 2000,
  });

  log.info({ servers: env.natsUrl }, 'Connected to NATS');

  nc.closed().then((err) => {
    if (err) log.error({ err }, 'NATS connection closed with error');
    else log.warn('NATS connection closed');
  });

  const jsm = await nc.jetstreamManager();
  try {
    await jsm.streams.add({
      name: USER_EVENTS_STREAM,
      subjects: ['users.*'],
      storage: 'file', // persistent across broker restarts
      retention: 'limits',
      max_msgs: 100000,
      max_age: 7 * 24 * 60 * 60 * 1000 * 1000000, // 7 days in nanoseconds
      discard: 'old',
      duplicate_window: 2 * 60 * 1000 * 1000000, // 2 min dedup window (ns)
    });
    log.info({ stream: USER_EVENTS_STREAM }, 'JetStream stream created');
  } catch (err) {
    // 503 "already in use" when the stream exists -> update instead of fail.
    if (err.message && err.message.includes('already in use')) {
      const info = await jsm.streams.info(USER_EVENTS_STREAM);
      if (info) {
        log.info({ stream: USER_EVENTS_STREAM }, 'JetStream stream already exists');
      }
    } else {
      throw err;
    }
  }

  const js = nc.jetstream();
  return { nc, js, jsm };
}

module.exports = { connectNats };
