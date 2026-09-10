/**
 * Gateway-local copy of the constants it uses.
 *
 * The gateway is deployed as an isolated serverless function (Vercel), where
 * files outside its own folder may not be included in the bundle. The two
 * backend services continue to use the repo-level `shared/` package; only the
 * gateway vendors these small modules to guarantee it can boot anywhere.
 */

/** Stable machine-readable error codes returned in API failures. */
const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL_ERROR',
  BAD_JSON: 'BAD_JSON',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  EVENT_INVALID: 'EVENT_INVALID',
  GATEWAY_NOT_CONFIGURED: 'GATEWAY_NOT_CONFIGURED',
};

module.exports = { ERROR_CODES };
