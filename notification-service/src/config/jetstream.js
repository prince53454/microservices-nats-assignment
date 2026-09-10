const { connect } = require('nats');
const logger = require('./logger');
const { USER_EVENTS_STREAM } = require('../../../shared/constants');

/**
 * Same provisioning logic as the user service: connect with credentials and
 * ensure the USER_EVENTS stream exists (idempotent, safe on every boot).
 */
async function connectNats(env, log = logger) {
  const nc = await connect({
    servers: env.natsUrl,
    user: env.natsUser,
    pass: env.natsPassword,
    maxReconnectAttempts: -1,
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
      storage: 'file',
      retention: 'limits',
      max_msgs: 100000,
      max_age: 7 * 24 * 60 * 60 * 1000 * 1000000,
      discard: 'old',
      duplicate_window: 2 * 60 * 1000 * 1000000,
    });
    log.info({ stream: USER_EVENTS_STREAM }, 'JetStream stream created');
  } catch (err) {
    if (err.message && err.message.includes('already in use')) {
      log.info({ stream: USER_EVENTS_STREAM }, 'JetStream stream already exists');
    } else {
      throw err;
    }
  }

  const js = nc.jetstream();
  return { nc, js, jsm };
}

module.exports = { connectNats };
