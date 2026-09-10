/**
 * Consistent response envelope (gateway-local copy — see lib/constants.js
 * for why it is vendored).
 * Success: { success: true, data }
 * Failure: { success: false, error: { code, message } }
 */
function sendSuccess(res, data, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data });
}

function sendError(res, statusCode, code, message, details = undefined) {
  const error = { code, message };
  if (details) error.details = details;
  return res.status(statusCode).json({ success: false, error });
}

module.exports = { sendSuccess, sendError };
