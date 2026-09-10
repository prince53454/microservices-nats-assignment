const { createProxyMiddleware } = require('http-proxy-middleware');
const { sendError } = require('../../../shared/utils/responses');
const { ERROR_CODES } = require('../../../shared/constants');
const env = require('../config/env');
const logger = require('../config/logger');

/**
 * Creates a reverse proxy to one backend service.
 *
 * - Streams bodies unmodified (JSON already parsed size-limited upstream).
 * - Applies a hard timeout so a hung service cannot hold clients forever.
 * - Translates upstream connection failures into a clean 503 envelope.
 */
function proxyTo(targetUrl, pathRewrite) {
  return createProxyMiddleware({
    target: targetUrl,
    changeOrigin: true,
    pathRewrite,
    timeout: env.proxyTimeoutMs, // upstream response timeout
    proxyTimeout: env.proxyTimeoutMs,
    on: {
      proxyReq: (proxyReq) => {
        // Present the internal API key so backend services accept our traffic
        // when they sit behind a public network (see shared/middleware/internalAuth).
        if (env.internalApiKey) {
          proxyReq.setHeader('x-internal-api-key', env.internalApiKey);
        }
      },
      error: (err, req, res) => {
        logger.error(
          { err: err.message, requestId: req.requestId, target: targetUrl },
          'Upstream service error'
        );
        if (res && !res.headersSent) {
          sendError(
            res,
            503,
            ERROR_CODES.UPSTREAM_UNAVAILABLE,
            'Backend service is unavailable, please try again later'
          );
        }
      },
    },
  });
}

module.exports = { proxyTo };
