const { RateLimiterMemory } = require('rate-limiter-flexible');
const { ApiError } = require('../../../shared/utils/ApiError');
const env = require('../config/env');

/**
 * Simple in-memory fixed-window rate limiter, keyed by authenticated user id
 * when available and client IP otherwise. (rate-limiter-flexible also ships
 * Redis-backed variants for multi-instance gateways.)
 */
const limiter = new RateLimiterMemory({
  points: env.rateLimitMax,       // max requests...
  duration: env.rateLimitWindowMs / 1000, // ...per this many seconds
});

async function rateLimit(req, res, next) {
  const key = req.auth?.sub || req.ip;
  try {
    await limiter.consume(key, 1);
    return next();
  } catch (rej) {
    const retryAfter = Math.ceil(rej.msBeforeNext / 1000);
    res.set('Retry-After', String(retryAfter));
    req.log?.warn({ requestId: req.requestId, key }, 'Rate limit exceeded');
    return next(ApiError.tooManyRequests(`Too many requests, retry in ${retryAfter}s`));
  }
}

module.exports = { rateLimit };
