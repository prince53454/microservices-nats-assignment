const { AckPolicy, DeliverPolicy } = require('nats');
const {
  USER_EVENTS_STREAM,
  USER_EVENTS_DURABLE,
  SUBJECTS,
  EVENT_TYPES,
} = require('../../../shared/constants');
const {
  validateEventEnvelope,
  validateEventData,
} = require('../../../shared/eventSchemas');
const { handleUserCreated, handleUserUpdated } = require('./handlers');
const logger = require('../config/logger');

/**
 * Durable JetStream consumer for user events.
 *
 * Guarantees:
 * - Durable consumer `notification-service-user-events` survives restarts.
 * - Explicit acks: a message is ACKed only after successful processing.
 * - On failure: nak() -> JetStream redelivers, up to maxDeliveries.
 * - Idempotency: the ProcessedEvent ledger ignores replayed eventIds.
 * - After maxDeliveries failures the message is terminally acknowledged
 *   (term()) and a copy is re-published to events.deadletter.
 */
class UserEventConsumer {
  /**
   * @param {import('nats').JetStreamManager} jsm
   * @param {import('nats').JetStreamClient} js
   * @param {number} maxDeliveries
   */
  constructor(jsm, js, maxDeliveries) {
    this.jsm = jsm;
    this.js = js;
    this.maxDeliveries = maxDeliveries;
    this.consumer = null;
    this.iteration = null;
  }

  /** Create (or reuse) the durable pull consumer, then start the loop. */
  async start() {
    try {
      await this.jsm.consumers.add(USER_EVENTS_STREAM, {
        durable_name: USER_EVENTS_DURABLE,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        ack_wait: 30 * 1000 * 1000000, // 30s in nanoseconds
        max_deliver: this.maxDeliveries,
        // All user lifecycle events; unknown types are acked and skipped.
        filter_subject: 'users.>',
      });
      logger.info({ durable: USER_EVENTS_DURABLE }, 'Durable consumer created');
    } catch (err) {
      // Consumer already exists: fine, multiple replicas share it.
      if (!String(err.message).includes('already in use')) throw err;
      logger.info({ durable: USER_EVENTS_DURABLE }, 'Durable consumer already exists');
    }

    this.consumer = await this.js.consumers.get(USER_EVENTS_STREAM, USER_EVENTS_DURABLE);
    this.runLoop();
    logger.info('Event consumption started');
  }

  /**
   * Runs the consume loop forever. If the iterator dies (disconnect, server
   * restart) it is recreated after a short delay, so the consumer self-heals
   * without process restarts. The durable consumer guarantees no message
   * is lost across these restarts.
   */
  async runLoop() {
    for (;;) {
      try {
        this.iteration = await this.consumer.consume({ max_messages: 1 });
        for await (const msg of this.iteration) {
          try {
            await this.process(msg);
          } catch (err) {
            // process() handles its own failures; this is a safety net.
            logger.error({ err }, 'Unexpected error in consumer loop');
          }
        }
        logger.warn('Consume iterator closed; restarting in 2s');
      } catch (err) {
        logger.error({ err }, 'Consume iterator failed; restarting in 2s');
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  /**
   * The core pipeline: validate -> dedupe -> handle -> ACK.
   * Throwing inside handle() triggers the nak/redelivery path.
   */
  async process(msg) {
    let event;
    let eventId = 'unknown';

    try {
      event = JSON.parse(Buffer.from(msg.data).toString('utf8'));
      eventId = event.eventId || 'unknown';
    } catch {
      logger.error({ subject: msg.subject }, 'Discarded non-JSON message');
      await this.deadLetter(msg, 'NOT_JSON');
      msg.term(); // malformed JSON will never succeed: no redelivery
      return;
    }

    const meta = msg.info || {};
    const deliveryCount = meta.deliveryCount || 1;

    // 1. Validate envelope + payload against shared schemas.
    const envCheck = validateEventEnvelope(event);
    if (envCheck.error) {
      logger.error({ eventId, issues: envCheck.error.details }, 'Invalid event envelope');
      await this.deadLetter(msg, 'INVALID_ENVELOPE');
      msg.term();
      return;
    }
    // Unknown event types are not errors: ack and skip so a future producer
    // version cannot stall this consumer (forward compatibility).
    const knownTypes = Object.values(EVENT_TYPES);
    if (!knownTypes.includes(event.eventType)) {
      logger.warn({ eventId, eventType: event.eventType }, 'Unknown event type: acking');
      msg.ack();
      return;
    }

    const dataCheck = validateEventData(event.eventType, event.data);
    if (dataCheck.error) {
      logger.error({ eventId, eventType: event.eventType }, 'Invalid event payload');
      await this.deadLetter(msg, 'INVALID_PAYLOAD');
      msg.term();
      return;
    }

    // 2. Idempotency: skip events already processed.
    const { ProcessedEvent } = require('../models/notification.model');
    const already = await ProcessedEvent.findOne({ eventId });
    if (already) {
      logger.info({ eventId }, 'Duplicate event ignored (already processed)');
      msg.ack();
      return;
    }

    // 3. Handle the event; any throw is retried via nak below.
    try {
      switch (event.eventType) {
        case EVENT_TYPES.USER_CREATED:
          await handleUserCreated(event.data);
          break;
        case EVENT_TYPES.USER_UPDATED:
          await handleUserUpdated(event.data);
          break;
        default:
          logger.warn({ eventId, eventType: event.eventType }, 'Unknown event type: acking');
          msg.ack();
          return;
      }
    } catch (err) {
      const finalAttempt = deliveryCount >= this.maxDeliveries;
      if (finalAttempt) {
        logger.error(
          { err, eventId, deliveryCount },
          'Max deliveries reached; moving to dead letter'
        );
        await this.deadLetter(msg, 'MAX_DELIVERY_FAILED');
        msg.term();
      } else {
        logger.warn(
          { err, eventId, deliveryCount, nextInMs: 2000 },
          'Processing failed; scheduling redelivery'
        );
        msg.nak(2000); // retry in 2s
      }
      return;
    }

    // 4. Record success for idempotency, then ACK.
    try {
      await ProcessedEvent.create({ eventId, eventType: event.eventType });
    } catch (err) {
      if (err.name === 'MongoServerError' && err.code === 11000) {
        // Raced with another replica that processed it first: fine.
        logger.info({ eventId }, 'Event already recorded by another replica');
      } else {
        // Ledger write failed: do NOT ack, or a crash would re-handle it.
        logger.error({ err, eventId }, 'Failed to record processed event');
        msg.nak(2000);
        return;
      }
    }

    logger.info({ eventId, eventType: event.eventType }, 'Event processed and ACKed');
    msg.ack();
  }

  /** Copy failed messages to the dead-letter subject for later inspection. */
  async deadLetter(msg, reason) {
    try {
      const payload = {
        reason,
        originalSubject: msg.subject,
        deadLetteredAt: new Date().toISOString(),
        payload: JSON.parse(Buffer.from(msg.data).toString('utf8')),
      };
      await this.js.publish(SUBJECTS.DEAD_LETTER, Buffer.from(JSON.stringify(payload)), {
        msgID: `dl-${reason}-${msg.info?.streamSequence ?? Date.now()}`,
      });
      logger.warn({ reason, subject: msg.subject }, 'Message dead-lettered');
    } catch (err) {
      logger.error({ err }, 'Failed to publish to dead-letter subject');
    }
  }

  async stop() {
    if (this.iteration) {
      this.iteration.stop();
      await this.iteration.closed;
    }
  }
}

module.exports = { UserEventConsumer };
