// Creates (if needed) and resets the test database, then applies all migrations.
// Used as Jest globalSetup by both services; also runnable directly.
const { Client } = require('pg');
const { TEST_DB_NAME, connectionConfig } = require('./db-config');
const { migrate } = require('./migrate');

async function prepareTestDb() {
  // Guard against ever wiping a real database
  if (!TEST_DB_NAME.endsWith('_test')) {
    throw new Error(`Refusing to reset "${TEST_DB_NAME}": test DB name must end with _test`);
  }

  const admin = new Client(connectionConfig('postgres'));
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB_NAME]);
    if (rowCount === 0) await admin.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
  } finally {
    await admin.end();
  }

  const db = new Client(connectionConfig(TEST_DB_NAME));
  await db.connect();
  try {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    await db.end();
  }

  await migrate({ database: TEST_DB_NAME });
}

if (require.main === module) {
  prepareTestDb()
    .then(() => console.log(`Test database "${TEST_DB_NAME}" is ready.`))
    .catch((err) => {
      console.error('Test DB setup failed:', err.message);
      process.exit(1);
    });
}

module.exports = prepareTestDb;
