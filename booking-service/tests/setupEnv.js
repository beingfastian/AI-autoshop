// Point the app at the test database before any module loads.
// dotenv never overrides variables that are already set, so these win over .env.
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'ai_receptionist_test';
process.env.SENDGRID_API_KEY = 'SG.test';
process.env.SENDGRID_FROM_EMAIL = 'noreply@test.local';
