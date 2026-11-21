// Usage: node scripts/migrate.js up|down [--count N] [--fake]
//   --fake marks migrations as applied without running them (baseline an existing DB).
const path = require('path');
const { runner } = require('node-pg-migrate');
const { ROOT, connectionConfig } = require('./db-config');

const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations');

async function migrate({ direction = 'up', count, fake = false, database } = {}) {
  return runner({
    databaseUrl: connectionConfig(database),
    dir: MIGRATIONS_DIR,
    migrationsTable: 'pgmigrations',
    direction,
    ...(count !== undefined && { count }),
    fake,
    log: () => {}
  });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const direction = args[0] === 'down' ? 'down' : 'up';
  const countIdx = args.indexOf('--count');
  const count = countIdx >= 0 ? Number(args[countIdx + 1]) : undefined;
  const fake = args.includes('--fake');

  migrate({ direction, count, fake })
    .then((ran) => {
      if (ran.length === 0) console.log('No migrations to run.');
      ran.forEach((m) => console.log(`${fake ? 'Marked' : 'Ran'} ${direction}: ${m.name}`));
    })
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = { migrate, MIGRATIONS_DIR };
