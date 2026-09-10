const { createProxyMiddleware } = require('http-proxy-middleware');
const { sendError } = require('../lib/responses');
const { ERROR_CODES } = require('../lib/constants');
const env = require('../config/env');
const logger = require('../config/logger');

/**
 * Creates a reverse proxy to one backend service — lazily.
 *
 * The middleware is created on the first request instead of at module load:
 * http-proxy-middleware throws at factory time when `target` is undefined,
 * which would crash a serverless function at boot whenever a service URL env
 * var is missing. Lazily, the route answers 503 naming the missing variable.
 *
 * - Streams bodies unmodified (JSON already parsed size-limited upstream).
 * - Applies a hard timeout so a hung service cannot hold clients forever.
 * - Translates upstream connection failures into a clean 503 envelope.
 */
function proxyTo(getTarget, pathRewrite, label) {
  let middleware = null;

  return function handle(req, res, next) {
    const target = typeof getTarget === 'function' ? getTarget() : getTarget;

    if (!target) {
      logger.error(
        { requestId: req.requestId, service: label },
        'Upstream service URL is not configured'
      );
      return sendError(
        res,
        503,
        ERROR_CODES.GATEWAY_NOT_CONFIGURED,
        `${label} is not configured on this deployment — see /healthz/env`
      );
    }

    if (!middleware) {
      middleware = createProxyMiddleware({
        target,
        changeOrigin: true,
        pathRewrite,
        timeout: env.proxyTimeoutMs, // upstream response timeout
        proxyTimeout: env.proxyTimeoutMs,
        on: {
          proxyReq: (proxyReq) => {
            // Present the internal API key so backend services accept our
            // traffic when they sit behind a public network
            // (see shared/middleware/internalAuth).
            if (env.internalApiKey) {
              proxyReq.setHeader('x-internal-api-key', env.internalApiKey);
            }
          },
          error: (err, req2, res2) => {
            logger.error(
              { err: err.message, requestId: req2.requestId, target },
              'Upstream service error'
            );
            if (res2 && !res2.headersSent) {
              sendError(
                res2,
                503,
                ERROR_CODES.UPSTREAM_UNAVAILABLE,
                'Backend service is unavailable, please try again later'
              );
            }
          },
        },
      });
    }

    return middleware(req, res, next);
  };
}

module.exports = { proxyTo };
