/**
 * Local demo runner — single process, zero external dependencies except
 * MongoDB on 127.0.0.1:27017.
 *
 *   node scripts/run-local-demo.js
 *
 * Boots: JetStream emulator (:4222) + user-service (:4001) +
 * notification-service (:4002) + api-gateway (:3000).
 * A require hook (scripts/nats-shim.js) routes the services' `require('nats')`
 * to the emulator, so the real event flow runs end to end.
 *
 * Every port is overridable via env vars (GATEWAY_PORT, USER_PORT,
 * NOTIFICATION_PORT, NATS_EMU_PORT) in case a port is already in use.
 */
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'local-demo-secret-local-demo-secret-32+';
process.env.NATS_URL = 'nats://127.0.0.1:4222';
process.env.NATS_USER = 'appuser';
process.env.NATS_PASSWORD = 'local-demo-password';
process.env.NATS_EMU_HOST = '127.0.0.1';
process.env.NATS_EMU_PORT = '4222';
process.env.LOG_LEVEL = 'info';

const NATS_EMU_PORT = Number(process.env.NATS_EMU_PORT || 4222);
const USER_PORT = Number(process.env.USER_PORT || 4001);
const NOTIFICATION_PORT = Number(process.env.NOTIFICATION_PORT || 4002);
const GATEWAY_PORT = Number(process.env.GATEWAY_PORT || 3000);

// Keep NATS_URL in sync with the (overridable) emulator port.
process.env.NATS_EMU_PORT = String(NATS_EMU_PORT);
process.env.NATS_URL = `nats://127.0.0.1:${NATS_EMU_PORT}`;

// Activate the require hook FIRST so service code picks up the shim.
require('./nats-shim.js');

const emulator = require('./nats-emulator-server');

async function waitFor(url, name, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`[demo] ${name} ready at ${url}`);
        return;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${name} did not become ready at ${url}`);
}

async function main() {
  await emulator.start(NATS_EMU_PORT);
  console.log(`[demo] JetStream emulator listening on 127.0.0.1:${NATS_EMU_PORT} (auth: appuser)`);

  // --- user-service (env read at require time) ---
  process.env.PORT = String(USER_PORT);
  process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/users_demo';
  require('../user-service/src/server.js'); // starts asynchronously
  await waitFor(`http://127.0.0.1:${USER_PORT}/health`, 'user-service');

  // --- notification-service ---
  process.env.PORT = String(NOTIFICATION_PORT);
  process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/notifications_demo';
  require('../notification-service/src/server.js');
  await waitFor(`http://127.0.0.1:${NOTIFICATION_PORT}/health`, 'notification-service');

  // --- api-gateway ---
  process.env.PORT = String(GATEWAY_PORT);
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${USER_PORT}`;
  process.env.NOTIFICATION_SERVICE_URL = `http://127.0.0.1:${NOTIFICATION_PORT}`;
  require('../api-gateway/src/server.js');
  await waitFor(`http://127.0.0.1:${GATEWAY_PORT}/health`, 'api-gateway');

  console.log('\n============================================================');
  console.log('[demo]  Stack is UP');
  console.log(`[demo]  Swagger UI : http://localhost:${GATEWAY_PORT}/api/docs`);
  console.log(`[demo]  Register   : POST http://localhost:${GATEWAY_PORT}/api/auth/register`);
  console.log('[demo]    {"name":"Vishwajeet","email":"a@b.com","password":"supersecret1"}');
  console.log(`[demo]  Then       : GET  http://localhost:${GATEWAY_PORT}/api/notifications`);
  console.log('============================================================\n');
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

main().catch((err) => {
  console.error('[demo] fatal:', err);
  process.exit(1);
});
