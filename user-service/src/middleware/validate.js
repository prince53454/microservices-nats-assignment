/**
 * Returns middleware that validates req[property] against a Joi schema.
 * On failure the central error handler turns the Joi error into a 400 with
 * per-field details; on success req[property] holds the sanitized value.
 */
const validate = (schema, property = 'body') => (req, res, next) => {
  const { error, value } = schema.validate(req[property], {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) return next(error);
  req[property] = value;
  return next();
};

module.exports = { validate };
