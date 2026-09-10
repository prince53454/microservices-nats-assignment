const Joi = require('joi');

/**
 * Envelope shared by every event flowing through JetStream.
 * Consumers validate incoming messages against this before touching the DB,
 * so a malformed event can never poison downstream processing.
 */
const eventEnvelopeSchema = Joi.object({
  eventId: Joi.string().guid({ version: 'uuidv4' }).required(),
  eventType: Joi.string().min(3).max(100).required(),
  eventVersion: Joi.number().integer().min(1).required(),
  timestamp: Joi.string().isoDate().required(),
  data: Joi.object().required(),
});

/** Payload for `user.created` events. */
const userCreatedSchema = Joi.object({
  userId: Joi.string().required(),
  name: Joi.string().min(1).max(80).required(),
  email: Joi.string().email().required(),
});

/** Payload for `user.updated` events. */
const userUpdatedSchema = Joi.object({
  userId: Joi.string().required(),
  name: Joi.string().min(1).max(80),
  email: Joi.string().email(),
}).or('name', 'email'); // at least one field must change

/**
 * Validate an event envelope. Returns { error } with a human-readable
 * message on failure, mirroring the shape of Joi's own result.
 */
function validateEventEnvelope(payload) {
  return eventEnvelopeSchema.validate(payload, { abortEarly: false });
}

/**
 * Validate the `data` payload for a given eventType.
 * Unknown event types are rejected (consumers only understand what they know).
 */
function validateEventData(eventType, data) {
  let schema;
  switch (eventType) {
    case 'user.created':
      schema = userCreatedSchema;
      break;
    case 'user.updated':
      schema = userUpdatedSchema;
      break;
    default:
      return { error: new Error(`Unsupported eventType "${eventType}"`) };
  }
  return schema.validate(data, { abortEarly: false });
}

module.exports = {
  eventEnvelopeSchema,
  userCreatedSchema,
  userUpdatedSchema,
  validateEventEnvelope,
  validateEventData,
};
