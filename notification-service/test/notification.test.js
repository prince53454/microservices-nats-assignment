const request = require('supertest');

// Mock infra before requiring app modules.
jest.mock('../src/config/env', () => ({
  nodeEnv: 'test',
  port: 4002,
  jwtSecret: 'test-secret-test-secret-test-secret!',
  mongoUri: 'mongodb://localhost:27017/test',
  natsUrl: 'nats://localhost:4222',
  natsUser: 'appuser',
  natsPassword: 'pass',
  maxDeliveries: 3,
  logLevel: 'error',
  isTest: true,
}));

jest.mock('../src/config/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../src/models/notification.model', () => {
  const Notification = {
    create: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(() => ({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    })),
    countDocuments: jest.fn().mockResolvedValue(0),
  };
  const ProcessedEvent = { findOne: jest.fn(), create: jest.fn() };
  return { Notification, ProcessedEvent };
});

const { Notification, ProcessedEvent } = require('../src/models/notification.model');
const { createApp } = require('../src/app');
const { validateEventEnvelope, validateEventData } = require('../../shared/eventSchemas');
const { UserEventConsumer } = require('../src/events/consumer');

const app = createApp();

const jwt = require('jsonwebtoken');
const SECRET = 'test-secret-test-secret-test-secret!';
const tokenFor = (userId) => jwt.sign({ sub: userId, email: 'a@b.com' }, SECRET, { expiresIn: '1h' });

const validEvent = (over = {}) => ({
  eventId: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a',
  eventType: 'user.created',
  eventVersion: 1,
  timestamp: new Date().toISOString(),
  data: { userId: '507f1f77bcf86cd799439011', name: 'Vishwajeet', email: 'vish@example.com' },
  ...over,
});

/** Build a fake JsMsg with recording ack/nak/term. */
function fakeMsg(event, deliveryCount = 1) {
  const calls = [];
  return {
    data: Buffer.from(JSON.stringify(event)),
    subject: 'users.created',
    info: { deliveryCount, streamSequence: 42 },
    ack: () => calls.push('ack'),
    nak: (ms) => calls.push(['nak', ms]),
    term: () => calls.push('term'),
    calls,
  };
}

describe('shared event validation', () => {
  it('accepts a well-formed event', () => {
    const { error } = validateEventEnvelope(validEvent());
    expect(error).toBeUndefined();
  });

  it('rejects missing eventId / bad uuid / bad timestamp', () => {
    expect(validateEventEnvelope(validEvent({ eventId: 'nope' })).error).toBeDefined();
    expect(validateEventEnvelope(validEvent({ timestamp: 'yesterday' })).error).toBeDefined();
    const { eventId, ...missing } = validEvent();
    expect(validateEventEnvelope(missing).error).toBeDefined();
  });

  it('rejects invalid user.created payloads', () => {
    expect(validateEventData('user.created', { userId: 'x' }).error).toBeDefined(); // missing name/email
    expect(validateEventData('user.created', { userId: 'x', name: 'A', email: 'bad' }).error).toBeDefined();
    expect(validateEventData('user.created', { userId: 'x', name: 'A', email: 'a@b.com' }).error).toBeUndefined();
  });

  it('rejects unknown event types', () => {
    expect(validateEventData('order.placed', {}).error).toBeDefined();
  });
});

describe('consumer idempotency', () => {
  const consumer = new UserEventConsumer({}, {}, 3);

  it('ACKs and ignores a duplicate eventId without creating a second notification', async () => {
    ProcessedEvent.findOne.mockResolvedValue({ eventId: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a' });
    Notification.create.mockClear();

    const msg = fakeMsg(validEvent());
    await consumer.process(msg);

    expect(msg.calls).toEqual(['ack']);
    expect(Notification.create).not.toHaveBeenCalled();
  });

  it('creates a notification and records the eventId for new events', async () => {
    ProcessedEvent.findOne.mockResolvedValue(null);
    Notification.create.mockResolvedValue({ id: 'n1' });

    const msg = fakeMsg(validEvent());
    await consumer.process(msg);

    expect(Notification.create).toHaveBeenCalledTimes(1);
    expect(Notification.create.mock.calls[0][0].type).toBe('WELCOME');
    expect(Notification.create.mock.calls[0][0].message).toContain('Vishwajeet');
    expect(ProcessedEvent.create).toHaveBeenCalledWith({
      eventId: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a',
      eventType: 'user.created',
    });
    expect(msg.calls).toEqual(['ack']);
  });

  it('naks (redelivery) when handling fails before max deliveries', async () => {
    ProcessedEvent.findOne.mockResolvedValue(null);
    Notification.create.mockRejectedValue(new Error('db down'));

    const msg = fakeMsg(validEvent(), 1);
    await consumer.process(msg);

    expect(msg.calls.length).toBe(1);
    expect(msg.calls[0][0]).toBe('nak');
  });

  it('dead-letters and terms after max deliveries', async () => {
    ProcessedEvent.findOne.mockResolvedValue(null);
    Notification.create.mockRejectedValue(new Error('db down'));
    consumer.js = { publish: jest.fn().mockResolvedValue({}) };

    const msg = fakeMsg(validEvent(), 3); // deliveryCount == maxDeliveries
    await consumer.process(msg);

    expect(msg.calls).toEqual(['term']);
    expect(consumer.js.publish).toHaveBeenCalledWith(
      'events.deadletter',
      expect.any(Buffer),
      expect.objectContaining({ msgID: expect.stringContaining('dl-') })
    );
  });

  it('terms malformed JSON immediately (no redelivery possible)', async () => {
    const msg = fakeMsg({});
    msg.data = Buffer.from('not-json');
    consumer.js = { publish: jest.fn().mockResolvedValue({}) };

    await consumer.process(msg);
    expect(msg.calls).toEqual(['term']);
  });

  it('naks when the idempotency ledger write fails (no ack, will retry)', async () => {
    ProcessedEvent.findOne.mockResolvedValue(null);
    Notification.create.mockResolvedValue({ id: 'n1' });
    ProcessedEvent.create.mockRejectedValue(new Error('ledger down'));

    const msg = fakeMsg(validEvent());
    await consumer.process(msg);

    expect(msg.calls[0][0]).toBe('nak');
  });
});

describe('notification API ownership', () => {
  it('401 without a token', async () => {
    const res = await request(app).get('/notifications');
    expect(res.status).toBe(401);
  });

  it('lists only the authenticated user\u2019s notifications', async () => {
    const findMock = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ id: 'n1', userId: 'u1' }]),
    };
    Notification.find.mockReturnValue(findMock);
    Notification.countDocuments.mockResolvedValue(1);

    const res = await request(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${tokenFor('u1')}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.notifications).toHaveLength(1);
    // The Mongo filter must be scoped to the caller's id:
    expect(Notification.find).toHaveBeenCalledWith({ userId: 'u1' });
  });

  it('returns 404 for a notification owned by somebody else', async () => {
    Notification.findOne.mockResolvedValue(null); // scoped findOne: no row for this owner

    const res = await request(app)
      .get('/notifications/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${tokenFor('u2')}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
