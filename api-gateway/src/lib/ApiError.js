const { ERROR_CODES } = require('./constants');

/**
 * Application error carrying an HTTP status and a stable machine-readable
 * code. Throw this anywhere; the central error middleware serializes it.
 * (Gateway-local copy — see lib/constants.js for why it is vendored.)
 */
class ApiError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError(400, ERROR_CODES.VALIDATION_ERROR, message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, ERROR_CODES.UNAUTHORIZED, message);
  }

  static forbidden(message = 'You do not have access to this resource') {
    return new ApiError(403, ERROR_CODES.FORBIDDEN, message);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, ERROR_CODES.NOT_FOUND, message);
  }

  static conflict(message) {
    return new ApiError(409, ERROR_CODES.CONFLICT, message);
  }

  static tooManyRequests(message = 'Too many requests') {
    return new ApiError(429, ERROR_CODES.RATE_LIMITED, message);
  }

  static serviceUnavailable(message) {
    return new ApiError(503, ERROR_CODES.UPSTREAM_UNAVAILABLE, message);
  }

  static internal(message = 'Something went wrong') {
    return new ApiError(500, ERROR_CODES.INTERNAL, message);
  }
}

module.exports = { ApiError };
