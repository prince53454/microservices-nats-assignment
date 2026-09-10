const { randomUUID } = require('crypto');
const logger = require('../config/logger');
const { USER_EVENTS_STREAM, SUBJECTS } = require('../../../shared/constants');

/**
 * Publishes user lifecycle events to NATS JetStream.
 *
 * JetStream's js.publish() waits for a server-side PubAck, so a failed
 * publish throws and the caller can react. `msgID` gives the broker
 * de-duplication: replaying the same eventId inside the duplicate window
 * returns `duplicate: true` instead of storing a second copy.
 */
class UserEventPublisher {
  /** @param {import('nats').JetStreamClient} js JetStream client */
  constructor(js) {
    this.js = js;
  }

  async publishUserCreated(user) {
    return this.publish(SUBJECTS.USER_CREATED, {
      userId: user.id,
      name: user.name,
      email: user.email,
    });
  }

  async publishUserUpdated(user, changedFields) {
    return this.publish(SUBJECTS.USER_UPDATED, {
      userId: user.id,
      ...changedFields,
    });
  }

  async publish(subject, data) {
    const event = {
      eventId: randomUUID(),
      eventType: subject === SUBJECTS.USER_CREATED ? 'user.created' : 'user.updated',
      eventVersion: 1,
      timestamp: new Date().toISOString(),
      data,
    };

    const ack = await this.js.publish(subject, Buffer.from(JSON.stringify(event)), {
      msgID: event.eventId, // broker-side dedup window
      timeout: 5000,
    });

    logger.info(
      {
        eventId: event.eventId,
        eventType: event.eventType,
        subject,
        stream: ack.stream,
        duplicate: ack.duplicate,
        userId: data.userId,
      },
      'Event published to JetStream'
    );

    return event;
  }
}

module.exports = { UserEventPublisher };
