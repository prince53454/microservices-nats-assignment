require('dotenv').config();
const Joi = require('joi');

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(3000),
  JWT_SECRET: Joi.string().min(32).required(),
  USER_SERVICE_URL: Joi.string().uri().required(),
  NOTIFICATION_SERVICE_URL: Joi.string().uri().required(),
  RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1000).default(60000),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).default(100),
  PROXY_TIMEOUT_MS: Joi.number().integer().min(1000).default(10000),
  // Optional: shared secret the gateway presents to backend services as
  // x-internal-api-key (used when services are reachable on public networks).
  INTERNAL_API_KEY: Joi.string().min(16).optional(),
  // How many proxy hops to trust for X-Forwarded-For (0 = direct connections,
  // 1 = docker-compose behind no proxy but one LB hop, 2 = Vercel/edge).
  TRUST_PROXY: Joi.number().integer().min(0).max(5).default(1),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('info'),
}).unknown(true);

const { value: env, error } = envSchema.validate(process.env, { abortEarly: false });

if (error) {
  // eslint-disable-next-line no-console -- logger cannot exist before env is valid
  console.error('Invalid environment variables:', error.details.map((d) => d.message).join(', '));
  process.exit(1);
}

module.exports = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  jwtSecret: env.JWT_SECRET,
  userServiceUrl: env.USER_SERVICE_URL,
  notificationServiceUrl: env.NOTIFICATION_SERVICE_URL,
  rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
  rateLimitMax: env.RATE_LIMIT_MAX,
  proxyTimeoutMs: env.PROXY_TIMEOUT_MS,
  internalApiKey: env.INTERNAL_API_KEY,
  trustProxy: env.TRUST_PROXY,
  logLevel: env.LOG_LEVEL,
};
