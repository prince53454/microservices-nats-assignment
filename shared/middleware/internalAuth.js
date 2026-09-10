const crypto = require('crypto');
const { ApiError } = require('../utils/ApiError');

/** Constant-time string comparison (no length leak beyond length itself). */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Optional gate for service-to-service HTTP calls.
 *
 * When a backend service sets INTERNAL_API_KEY, every request must carry
 * `x-internal-api-key: <value>` — the API Gateway injects it before proxying.
 * Leave INTERNAL_API_KEY unset to disable the gate (local development,
 * docker-compose internal network, and tests), where network isolation is
 * provided by Docker instead.
 *
 * This exists for the hybrid cloud topology (e.g. gateway on Vercel, services
 * on Railway) where backend services must have public URLs: the key stops
 * random internet traffic from reaching them directly.
 */
function requireInternalApiKey(req, res, next) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) return next();

  const provided = req.get('x-internal-api-key');
  if (!provided || !safeEqual(provided, expected)) {
    return next(ApiError.unauthorized('Missing or invalid internal API key'));
  }
  return next();
}

module.exports = { requireInternalApiKey };
