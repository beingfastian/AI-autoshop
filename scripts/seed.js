// Loads database/seed.sql into the dev database. Idempotent.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { ROOT, connectionConfig } = require('./db-config');

async function seed(database) {
  const client = new Client(connectionConfig(database));
  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(ROOT, 'database', 'seed.sql'), 'utf8'));
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  seed()
    .then(() => console.log('Seed data loaded.'))
    .catch((err) => {
      console.error('Seed failed:', err.message);
      process.exit(1);
    });
}

module.exports = { seed };
