const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { proxyTo } = require('../services/proxy');
const env = require('../config/env');

const router = Router();

// NOTE: mounted at /api by the app, so paths seen here have /api stripped
// (e.g. the gateway route /api/auth/register appears here as /auth/register).

// ---- Public: authentication -> user-service /users/* ----
router.post(
  '/auth/register',
  proxyTo(env.userServiceUrl, { '^/auth': '/users' })
);
router.post(
  '/auth/login',
  proxyTo(env.userServiceUrl, { '^/auth': '/users' })
);

// ---- Protected: user profile -> user-service /users/me ----
router.use('/users/me', authenticate);
router.get('/users/me', proxyTo(env.userServiceUrl));
router.patch('/users/me', proxyTo(env.userServiceUrl));

// ---- Protected: notifications -> notification-service /notifications ----
router.use('/notifications', authenticate);
router.get('/notifications', proxyTo(env.notificationServiceUrl));
router.get('/notifications/:id', proxyTo(env.notificationServiceUrl));

module.exports = router;
