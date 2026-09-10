/**
 * Single source of truth for names shared across services.
 * Keeping these central prevents typo-drift between publisher and consumer.
 */

/** JetStream stream that captures all user lifecycle events. */
const USER_EVENTS_STREAM = 'USER_EVENTS';

/** Subjects on the USER_EVENTS stream. */
const SUBJECTS = {
  USER_CREATED: 'users.created',
  USER_UPDATED: 'users.updated',
  DEAD_LETTER: 'events.deadletter',
};

/** Durable consumer used by the Notification Service (survives restarts). */
const USER_EVENTS_DURABLE = 'notification-service-user-events';

/** Event type strings carried inside the event envelope. */
const EVENT_TYPES = {
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
};

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
  // Gateway booted but a required env var is missing; the affected route is
  // disabled (see /healthz/env for what is configured).
  GATEWAY_NOT_CONFIGURED: 'GATEWAY_NOT_CONFIGURED',
};

module.exports = {
  USER_EVENTS_STREAM,
  SUBJECTS,
  USER_EVENTS_DURABLE,
  EVENT_TYPES,
  ERROR_CODES,
};
