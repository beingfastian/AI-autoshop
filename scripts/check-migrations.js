// Proves the migrations are safe to run against a real database:
//   1. each migration can be rolled back and re-applied at its position
//   2. rolling everything back leaves an empty schema, and re-applying works
//   3. data written under the old schema survives every later migration
// Runs on its own throwaway database (<TEST_DB_NAME without _test>_migrations_test).
// It is a plain script, not a Jest test, because node-pg-migrate is ESM-only and Jest can't load it.
const fs = require('fs');
const { Client } = require('pg');
const { TEST_DB_NAME, connectionConfig } = require('./db-config');
const { migrate, MIGRATIONS_DIR } = require('./migrate');
const { resetDatabase } = require('./test-db');

const DB = TEST_DB_NAME.replace(/_test$/, '_migrations_test');
const MIGRATIONS = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

function assert(condition, message) {
  if (!condition) throw new Error(`Migration check failed: ${message}`);
}

async function withClient(fn) {
  const client = new Client(connectionConfig(DB));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// Tables, columns, constraints, indexes, views and functions, so "same schema" can be compared exactly
const schemaSnapshot = () =>
  withClient(async (c) => {
    const { rows } = await c.query(`
      SELECT 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || COALESCE(column_default, '') || ':' || is_nullable AS item
        FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> 'pgmigrations'
      UNION ALL SELECT 'con:' || conrelid::regclass || ':' || conname || ':' || pg_get_constraintdef(oid)
        FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text <> 'pgmigrations'
      UNION ALL SELECT 'idx:' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename <> 'pgmigrations'
      UNION ALL SELECT 'view:' || viewname || ':' || definition FROM pg_views WHERE schemaname = 'public'
      UNION ALL SELECT 'fn:' || proname FROM pg_proc p WHERE pronamespace = 'public'::regnamespace
        -- extensions (uuid-ossp, pg_trgm) are created IF NOT EXISTS and deliberately left installed on rollback
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
      UNION ALL SELECT 'trg:' || tgrelid::regclass || ':' || tgname FROM pg_trigger WHERE NOT tgisinternal
      ORDER BY 1`);
    return rows.map((r) => r.item);
  });

async function checkEachMigrationReverses() {
  await resetDatabase(DB);
  for (const name of MIGRATIONS) {
    const before = await schemaSnapshot();
    await migrate({ database: DB, count: 1 });
    const after = await schemaSnapshot();
    await migrate({ database: DB, direction: 'down', count: 1 });
    const rolledBack = await schemaSnapshot();
    assert(
      JSON.stringify(rolledBack) === JSON.stringify(before),
      `rolling back ${name} does not restore the previous schema.\n` +
        `Left over: ${rolledBack.filter((x) => !before.includes(x)).join(', ') || 'none'}\n` +
        `Missing: ${before.filter((x) => !rolledBack.includes(x)).join(', ') || 'none'}`
    );
    await migrate({ database: DB, count: 1 });
    assert(JSON.stringify(await schemaSnapshot()) === JSON.stringify(after), `re-applying ${name} gives a different schema`);
    console.log(`  ✓ ${name} rolls back and re-applies`);
  }
}

async function checkFullRollback() {
  await migrate({ database: DB, direction: 'down', count: Infinity });
  const leftovers = await schemaSnapshot();
  assert(leftovers.length === 0, `full rollback leaves objects behind: ${leftovers.join(', ')}`);
  await migrate({ database: DB });
  console.log('  ✓ full rollback leaves an empty schema, and everything re-applies');
}

// Writes data the way the original app did (before 0003), then applies the rest
async function checkDataSurvives() {
  await resetDatabase(DB);
  await migrate({ database: DB, count: 2 });

  const ids = await withClient(async (c) => {
    const w = await c.query(`INSERT INTO workshops (name, email, phone, timezone) VALUES ('Old Shop', 'old@test.local', '+920000000', 'Asia/Karachi') RETURNING id`);
    const cu = await c.query(`INSERT INTO customers (workshop_id, name, phone) VALUES ($1, 'Ali', '+923001234567') RETURNING id`, [w.rows[0].id]);
    const call = await c.query(`INSERT INTO calls (workshop_id, from_number, to_number, status) VALUES ($1, '+923001234567', '+920000000', 'completed') RETURNING id`, [w.rows[0].id]);
    const b = await c.query(
      `INSERT INTO bookings (workshop_id, customer_id, call_id, scheduled_at, issue_summary, status, customer_email_sent)
       VALUES ($1, $2, $3, '2030-01-15 14:00:00', 'Brake noise', 'cancelled', true) RETURNING id`,
      [w.rows[0].id, cu.rows[0].id, call.rows[0].id]
    );
    return { workshop: w.rows[0].id, booking: b.rows[0].id };
  });

  await migrate({ database: DB });

  await withClient(async (c) => {
    const tz = (await c.query('SHOW TimeZone')).rows[0].TimeZone;
    const { rows } = await c.query(
      `SELECT b.status, b.customer_email_sent, b.cancelled_at,
              to_char(b.scheduled_at AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS local_time,
              w.timezone, w.slot_minutes, w.bay_count, w.notify_emails
         FROM bookings b JOIN workshops w ON w.id = b.workshop_id WHERE b.id = $1`,
      [ids.booking, tz]
    );
    const row = rows[0];
    assert(row, 'the booking written before the migrations is gone');
    assert(row.local_time === '2030-01-15 14:00', `scheduled_at changed meaning: ${row.local_time}`);
    assert(row.status === 'cancelled' && row.customer_email_sent === true, 'booking fields changed');
    assert(row.cancelled_at === null, 'old cancelled booking should keep a NULL cancelled_at (constraint is NOT VALID)');
    assert(row.timezone === 'Asia/Karachi' && row.slot_minutes === 60 && row.bay_count === 2, 'workshop defaults not applied');
    assert(Array.isArray(row.notify_emails) && row.notify_emails.length === 0, 'notify_emails default not applied');
  });
  console.log('  ✓ data written under the original schema survives all migrations');
}

async function checkMigrations() {
  console.log(`Checking ${MIGRATIONS.length} migrations on "${DB}"`);
  await checkEachMigrationReverses();
  await checkFullRollback();
  await checkDataSurvives();
  console.log('All migration checks passed.');
}

if (require.main === module) {
  checkMigrations().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { checkMigrations };
