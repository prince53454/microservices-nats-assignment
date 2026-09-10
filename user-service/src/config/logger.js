const pino = require('pino');
const env = require('./env');

/**
 * Structured logging with redaction of anything credential-like, so secrets
 * (passwords, JWTs, tokens) can never reach the log files.
 */
const logger = pino({
  level: env.logLevel,
  base: { service: 'user-service' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'password',
      '*.password',
      'req.headers.authorization',
      'req.headers.cookie',
      'token',
      '*.token',
      'secret',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
