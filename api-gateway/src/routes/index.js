const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { proxyTo } = require('../services/proxy');
const env = require('../config/env');

const router = Router();

// NOTE: mounted at /api by the app, so paths seen here have /api stripped
// (e.g. the gateway route /api/auth/register appears here as /auth/register).

// ---- Public: authentication -> user-service /users/* ----
// Targets are passed as getters: proxy creation is deferred to the first
// request, so a missing service URL degrades to a 503 instead of crashing.
router.post(
  '/auth/register',
  proxyTo(() => env.userServiceUrl, { '^/auth': '/users' }, 'user-service')
);
router.post(
  '/auth/login',
  proxyTo(() => env.userServiceUrl, { '^/auth': '/users' }, 'user-service')
);

// ---- Protected: user profile -> user-service /users/me ----
router.use('/users/me', authenticate);
router.get('/users/me', proxyTo(() => env.userServiceUrl, null, 'user-service'));
router.patch('/users/me', proxyTo(() => env.userServiceUrl, null, 'user-service'));

// ---- Protected: notifications -> notification-service /notifications ----
router.use('/notifications', authenticate);
router.get('/notifications', proxyTo(() => env.notificationServiceUrl, null, 'notification-service'));
router.get('/notifications/:id', proxyTo(() => env.notificationServiceUrl, null, 'notification-service'));

module.exports = router;
