/**
 * Consistent response envelope used by every service and the gateway.
 * Success: { success: true, data }
 * Failure: { success: false, error: { code, message, details? } }
 */
function sendSuccess(res, data, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data });
}

function sendError(res, statusCode, code, message, details) {
  const error = { code, message };
  if (details) error.details = details;
  return res.status(statusCode).json({ success: false, error });
}

module.exports = { sendSuccess, sendError };
