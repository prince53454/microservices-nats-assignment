const { randomUUID } = require('crypto');
const logger = require('../config/logger');

/** Attaches requestId + child logger, logs every completed request. */
function requestLogger(req, res, next) {
  req.requestId = req.get('x-request-id') || randomUUID();
  res.set('x-request-id', req.requestId);
  req.log = logger.child({ requestId: req.requestId });

  const start = Date.now();
  res.on('finish', () => {
    req.log.info(
      {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
        userId: req.auth?.sub,
      },
      'request completed'
    );
  });
  next();
}

module.exports = { requestLogger };
