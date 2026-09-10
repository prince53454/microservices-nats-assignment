const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/env', () => ({
  nodeEnv: 'test',
  port: 3000,
  jwtSecret: 'test-secret-test-secret-test-secret!',
  userServiceUrl: 'http://localhost:49991',
  notificationServiceUrl: 'http://localhost:49992',
  rateLimitWindowMs: 60000,
  rateLimitMax: 3, // low limit so tests can trigger 429
  proxyTimeoutMs: 5000,
  trustProxy: 1,
  logLevel: 'error',
}));

jest.mock('../src/config/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { createApp } = require('../src/app');
const app = createApp();

const SECRET = 'test-secret-test-secret-test-secret!';
const token = jwt.sign({ sub: 'u1', email: 'a@b.com' }, SECRET, { expiresIn: '1h' });

describe('gateway auth gating', () => {
  it('GET /api/users/me without token -> 401', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/notifications with invalid token -> 401', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
  });

  it('GET /api/users/me with valid token reaches the proxy (503 when service down)', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`);
    // No backend running on 49991 -> clean 503 envelope, not a crash.
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
  });
});

describe('gateway responses', () => {
  it('unknown routes return the standard error envelope', async () => {
    const res = await request(app).get('/api/nope').set('X-Forwarded-For', '10.1.1.7');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('health endpoint returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.service).toBe('api-gateway');
  });
});

describe('rate limiting', () => {
  it('returns 429 after the configured number of requests', async () => {
    // Unique path per test run to avoid clashing with other tests' buckets.
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', '10.9.9.9');
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
    expect(statuses[statuses.length - 1]).toBe(429);
  });
});
