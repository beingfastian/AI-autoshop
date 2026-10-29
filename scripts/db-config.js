// Shared DB connection settings for the root scripts (migrations, seed, test DB).
// Reads the same DB_* variables the services use. Root .env wins; voice-service/.env is
// the fallback so local setup doesn't need a third env file.
const path = require('path');
const dotenv = require('dotenv');

const ROOT = path.join(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
dotenv.config({ path: path.join(ROOT, 'voice-service', '.env'), quiet: true });

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'ai_receptionist_test';

function connectionConfig(database) {
  if (!database && process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: database || process.env.DB_NAME || 'ai_receptionist',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  };
}

module.exports = { ROOT, TEST_DB_NAME, connectionConfig };
