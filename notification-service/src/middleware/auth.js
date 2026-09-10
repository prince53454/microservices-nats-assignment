const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { ApiError } = require('../../../shared/utils/ApiError');

/**
 * Verifies the Bearer JWT and attaches the payload to req.user.
 * Ownership is enforced in the controller: users only see their own rows.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }

  try {
    req.user = jwt.verify(token, env.jwtSecret);
    return next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token';
    req.log?.warn({ requestId: req.requestId, reason: err.name }, 'Authentication failed');
    return next(ApiError.unauthorized(message));
  }
}

module.exports = { authenticate };
