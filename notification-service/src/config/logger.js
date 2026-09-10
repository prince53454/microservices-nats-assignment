const pino = require('pino');
const env = require('./env');

const logger = pino({
  level: env.logLevel,
  base: { service: 'notification-service' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'token', '*.token', 'secret'],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
