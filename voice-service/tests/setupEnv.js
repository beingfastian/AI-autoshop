// Point the app at the test database and stub external services before any module loads.
// dotenv never overrides variables that are already set, so these win over .env.
const { testDbEnv } = require('../../scripts/db-config');

process.env.NODE_ENV = 'test';
Object.assign(process.env, testDbEnv()); // same DB the global setup prepared, even if configured via DATABASE_URL
process.env.VAPI_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.BOOKING_SERVICE_URL = 'http://127.0.0.1:9'; // unreachable on purpose: notify fails fast
