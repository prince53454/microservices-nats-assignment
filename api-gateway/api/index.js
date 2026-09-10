/**
 * Serverless entrypoint for Vercel.
 *
 * The gateway is stateless HTTP (JWT verification + proxying), which is why it
 * deploys fine on serverless. The backend services CANNOT: the notification
 * service runs a persistent JetStream consumer that must stay connected, so
 * user-service and notification-service deploy as containers (e.g. Railway).
 *
 * Vercel invokes this file for every request. The app is created once per
 * lambda instance and reused across warm invocations, so middleware and the
 * JWT secret are initialised once, not per request.
 */
const { createApp } = require('../src/app');

const app = createApp();

module.exports = (req, res) => app(req, res);
