// Point the app at the test database and stub external services before any module loads.
// dotenv never overrides variables that are already set, so these win over .env.
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'ai_receptionist_test';
process.env.VAPI_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.BOOKING_SERVICE_URL = 'http://127.0.0.1:9'; // unreachable on purpose: notify fails fast
