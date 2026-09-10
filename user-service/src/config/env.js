require('dotenv').config();
const Joi = require('joi');

/**
 * Central environment validation: the process refuses to start with a bad
 * or missing variable instead of failing later at runtime.
 */
const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(4001),
  JWT_SECRET: Joi.string().min(32).required(),
  MONGO_URI: Joi.string().uri({ scheme: ['mongodb', 'mongodb+srv'] }).required(),
  NATS_URL: Joi.string().required(),
  NATS_USER: Joi.string().required(),
  NATS_PASSWORD: Joi.string().required(),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('info'),
}).unknown(true);

const { value: env, error } = envSchema.validate(process.env, { abortEarly: false });

if (error) {
  // Throw rather than process.exit so serverless logs show WHICH variable is
  // missing instead of a bare FUNCTION_INVOCATION_FAILED.
  // eslint-disable-next-line no-console -- logger cannot exist before env is valid
  console.error('Invalid environment variables:', error.details.map((d) => d.message).join(', '));
  throw new Error(
    `Invalid environment variables: ${error.details.map((d) => d.message).join(', ')}`
  );
}

module.exports = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  jwtSecret: env.JWT_SECRET,
  mongoUri: env.MONGO_URI,
  natsUrl: env.NATS_URL,
  natsUser: env.NATS_USER,
  natsPassword: env.NATS_PASSWORD,
  logLevel: env.LOG_LEVEL,
  isTest: env.NODE_ENV === 'test',
};
