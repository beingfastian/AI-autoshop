// Point the app at the test database and stub external services before any module loads.
// dotenv never overrides variables that are already set, so these win over .env.
const { testDbEnv } = require('../../scripts/db-config');

process.env.NODE_ENV = 'test';
process.env.LOGIN_RATE_LIMIT = '1000'; // every test signs in from one IP; auth.test.js checks the limiter itself
Object.assign(process.env, testDbEnv()); // same DB the global setup prepared, even if configured via DATABASE_URL
// The app prefers DATABASE_URL, which points at the REAL database: tests must only use the test DB.
// Set to empty (not deleted): dotenv never overrides an existing variable, so a DATABASE_URL in
// server/.env (e.g. Neon) can't sneak back in.
process.env.DATABASE_URL = '';
process.env.VOICE_AGENT_KEY = 'test-voice-agent-key-0123456789abcdef';
process.env.API_KEY = 'test-api-key-0123456789abcdef0123456789';
process.env.SENDGRID_API_KEY = 'SG.test';
process.env.SENDGRID_FROM_EMAIL = 'noreply@test.local';
