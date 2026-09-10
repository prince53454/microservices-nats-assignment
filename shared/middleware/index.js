const { ApiError } = require('../utils/ApiError');
const { sendError } = require('../utils/responses');
const { ERROR_CODES } = require('../constants');
const { requireInternalApiKey } = require('./internalAuth');

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
 * Central error-handling middleware. Every error (ApiError, Joi, Mongo,
 * unexpected) is converted into the standard failure envelope. Duplicate
 * Mongo keys become 409, validation errors become 400 with field details,
 * and anything unknown is logged but masked as a generic 500 to clients.
 */
// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let code = err.code || ERROR_CODES.INTERNAL;
  let message = err.message || 'Something went wrong';
  let details;

  // Joi validation errors -> 400 with a per-field detail list.
  if (err.isJoi) {
    statusCode = 400;
    code = ERROR_CODES.VALIDATION_ERROR;
    message = err.details.map((d) => d.message).join('; ');
    details = err.details.map((d) => ({ field: d.path.join('.'), message: d.message }));
  }

  // Mongo duplicate key (e.g. registering an email that already exists).
  if (err.name === 'MongoServerError' && err.code === 11000) {
    statusCode = 409;
    code = ERROR_CODES.CONFLICT;
    message = 'Resource already exists';
  }

  // Never leak stack traces or internal messages to clients.
  if (statusCode >= 500) {
    message = 'Internal server error';
  }

  if (statusCode >= 500) {
    req.log?.error({ err, requestId: req.requestId }, 'Unhandled error');
  }

  return sendError(res, statusCode, code, message, details);
}

module.exports = { notFoundHandler, errorHandler, ApiError, requireInternalApiKey };
