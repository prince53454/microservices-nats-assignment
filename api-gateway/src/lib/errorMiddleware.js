const { ApiError } = require('./ApiError');
const { sendError } = require('./responses');
const { ERROR_CODES } = require('./constants');

/** 404 for unknown routes, formatted like every other error. */
function notFoundHandler(req, res) {
  return sendError(
    res,
    404,
    ERROR_CODES.NOT_FOUND,
    `Route ${req.method} ${req.originalUrl} not found`
  );
}

/**
 * Central error-handling middleware (gateway-local copy — see
 * lib/constants.js for why it is vendored). Joi and Mongo errors are mapped
 * like the backend services; anything unknown is logged but masked as a
 * generic 500 to clients.
 */
// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let code = err.code || ERROR_CODES.INTERNAL;
  let message = err.message || 'Something went wrong';
  let details;

  if (err.isJoi) {
    statusCode = 400;
    code = ERROR_CODES.VALIDATION_ERROR;
    message = err.details.map((d) => d.message).join('; ');
    details = err.details.map((d) => ({ field: d.path.join('.'), message: d.message }));
  }

  if (err.name === 'MongoServerError' && err.code === 11000) {
    statusCode = 409;
    code = ERROR_CODES.CONFLICT;
    message = 'Resource already exists';
  }

  if (statusCode >= 500) {
    message = 'Internal server error';
    req.log?.error({ err, requestId: req.requestId }, 'Unhandled error');
  }

  return sendError(res, statusCode, code, message, details);
}

module.exports = { notFoundHandler, errorHandler, ApiError };
