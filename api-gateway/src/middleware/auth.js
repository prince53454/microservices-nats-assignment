const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { ApiError } = require('../lib/ApiError');

/**
 * Gateway-side JWT verification. The gateway validates the token and forwards
 * only the verified claims (x-user-id / x-user-email) downstream. Backend
 * services still verify the original Bearer token themselves, so a spoofed
 * header without a valid token cannot pass.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.auth = payload;
    // Forward verified identity to backend services.
    req.headers['x-user-id'] = payload.sub;
    req.headers['x-user-email'] = payload.email || '';
    return next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token';
    req.log?.warn({ requestId: req.requestId, reason: err.name }, 'Authentication failed at gateway');
    return next(ApiError.unauthorized(message));
  }
}

module.exports = { authenticate };
