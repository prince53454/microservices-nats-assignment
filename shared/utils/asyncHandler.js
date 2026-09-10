/**
 * Wraps an async route handler so thrown errors reach the central
 * error-handling middleware instead of hanging as unhandled rejections.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { asyncHandler };
