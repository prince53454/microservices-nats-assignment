const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { ApiError } = require('../../../shared/utils/ApiError');

/**
 * Validates the `Authorization: Bearer <token>` header and attaches the
 * decoded payload to req.user. Services never trust raw header data:
 * everything else must come from the verified token.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }

  try {
    req.user = jwt.verify(token, env.jwtSecret); // { sub, email, iat, exp }
    req.log?.debug({ userId: req.user.sub }, 'Request authenticated');
    return next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token';
    req.log?.warn({ requestId: req.requestId, reason: err.name }, 'Authentication failed');
    return next(ApiError.unauthorized(message));
  }
}

module.exports = { authenticate };
