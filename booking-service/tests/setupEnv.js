// Point the app at the test database before any module loads.
// dotenv never overrides variables that are already set, so these win over .env.
const { testDbEnv } = require('../../scripts/db-config');

process.env.NODE_ENV = 'test';
Object.assign(process.env, testDbEnv()); // same DB the global setup prepared, even if configured via DATABASE_URL
process.env.SENDGRID_API_KEY = 'SG.test';
process.env.SENDGRID_FROM_EMAIL = 'noreply@test.local';
