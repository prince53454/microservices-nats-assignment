const request = require('supertest');
const mongoose = require('mongoose');

// In-memory MongoDB would normally be used; here we mock the repository layer
// and the NATS publisher so these are true unit/integration-lite tests that
// run anywhere without Docker.
jest.mock('../src/services/user.repository', () => ({
  findByEmail: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
}));

jest.mock('../src/config/env', () => ({
  nodeEnv: 'test',
  port: 4001,
  jwtSecret: 'test-secret-test-secret-test-secret!',
  mongoUri: 'mongodb://localhost:27017/test',
  natsUrl: 'nats://localhost:4222',
  natsUser: 'appuser',
  natsPassword: 'pass',
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

const repo = require('../src/services/user.repository');
const { createApp } = require('../src/app');
const userService = require('../src/services/user.service');

const app = createApp();
const fakePublisher = {
  publishUserCreated: jest.fn().mockResolvedValue({}),
  publishUserUpdated: jest.fn().mockResolvedValue({}),
};
// server.js injects the real JetStream publisher via app.locals; tests inject a fake.
app.locals.publisher = fakePublisher;

const makeUser = (over = {}) => ({
  id: '507f1f77bcf86cd799439011',
  name: 'Vishwajeet',
  email: 'vish@example.com',
  isActive: true,
  password: '$2a$10$hashed',
  createdAt: new Date(),
  updatedAt: new Date(),
  toJSON() {
    const { password, ...rest } = this;
    return rest;
  },
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('POST /users/register', () => {
  it('rejects invalid payloads with 400 and field details', async () => {
    const res = await request(app).post('/users/register').send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'email', 'password']));
  });

  it('rejects duplicate email with 409', async () => {
    repo.findByEmail.mockResolvedValue(makeUser());

    const res = await request(app).post('/users/register').send({
      name: 'Vishwajeet',
      email: 'vish@example.com',
      password: 'supersecret1',
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('registers a user, never returns a hash, and publishes user.created', async () => {
    repo.findByEmail.mockResolvedValue(null);
    repo.create.mockImplementation(async ({ name, email }) => makeUser({ name, email }));

    const res = await request(app).post('/users/register').send({
      name: 'Vishwajeet',
      email: 'vish@example.com',
      password: 'supersecret1',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('vish@example.com');
    expect(res.body.data.user.password).toBeUndefined();
    expect(typeof res.body.data.token).toBe('string');
    expect(fakePublisher.publishUserCreated).toHaveBeenCalledTimes(1);
  });
});

describe('POST /users/login', () => {
  it('returns 401 for unknown email', async () => {
    repo.findByEmail.mockResolvedValue(null);
    const res = await request(app).post('/users/login').send({
      email: 'ghost@example.com',
      password: 'whatever1',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for wrong password', async () => {
    const bcrypt = require('bcryptjs');
    const user = makeUser();
    user.password = await bcrypt.hash('correct-password', 4);
    repo.findByEmail.mockResolvedValue(user);

    const res = await request(app).post('/users/login').send({
      email: 'vish@example.com',
      password: 'wrong-password',
    });
    expect(res.status).toBe(401);
  });

  it('returns a JWT on success', async () => {
    const bcrypt = require('bcryptjs');
    const user = makeUser();
    user.password = await bcrypt.hash('correct-password', 4);
    repo.findByEmail.mockResolvedValue(user);

    const res = await request(app).post('/users/login').send({
      email: 'vish@example.com',
      password: 'correct-password',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();
  });
});

describe('JWT-protected endpoints', () => {
  let token;

  beforeAll(async () => {
    const bcrypt = require('bcryptjs');
    const user = makeUser();
    user.password = await bcrypt.hash('correct-password', 4);
    repo.findByEmail.mockResolvedValue(user);
    const res = await request(app).post('/users/login').send({
      email: 'vish@example.com',
      password: 'correct-password',
    });
    token = res.body.data.token;
  });

  it('GET /users/me without token -> 401', async () => {
    const res = await request(app).get('/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /users/me with garbage token -> 401', async () => {
    const res = await request(app).get('/users/me').set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
  });

  it('GET /users/me with valid token -> 200 profile without hash', async () => {
    repo.findById.mockResolvedValue(makeUser());
    const res = await request(app).get('/users/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('vish@example.com');
    expect(res.body.data.user.password).toBeUndefined();
  });

  it('PATCH /users/me updates name and publishes user.updated', async () => {
    repo.updateById.mockResolvedValue(makeUser({ name: 'New Name' }));
    const res = await request(app)
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.name).toBe('New Name');
    expect(fakePublisher.publishUserUpdated).toHaveBeenCalledTimes(1);
  });
});

describe('user service internals', () => {
  it('getProfile throws 404 for unknown user', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(userService.getProfile('507f1f77bcf86cd799439011')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('internal API key gate', () => {
  const original = process.env.INTERNAL_API_KEY;

  afterAll(() => {
    if (original === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = original;
  });

  it('lets requests through when INTERNAL_API_KEY is unset', async () => {
    delete process.env.INTERNAL_API_KEY;
    const res = await request(app).get('/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/Authorization/i); // JWT error, not key error
  });

  it('rejects business routes without the key when it is set', async () => {
    process.env.INTERNAL_API_KEY = 'test-internal-key-123456';
    const res = await request(app).get('/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/internal API key/i);
  });

  it('accepts business routes carrying the correct key', async () => {
    process.env.INTERNAL_API_KEY = 'test-internal-key-123456';
    const res = await request(app)
      .get('/users/me')
      .set('x-internal-api-key', 'test-internal-key-123456');
    // Past the gate, blocked by JWT auth instead -> proves the gate passed it on
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/Authorization/i);
  });

  it('keeps /health public so platform healthchecks work', async () => {
    process.env.INTERNAL_API_KEY = 'test-internal-key-123456';
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});

afterAll(async () => {
  await mongoose.connection.close().catch(() => {});
});
