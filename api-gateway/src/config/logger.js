const pino = require('pino');
const env = require('./env');

const logger = pino({
  level: env.logLevel,
  base: { service: 'api-gateway' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'password', '*.password', 'token', '*.token', 'secret'],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
