// Test helpers: DB reset, fixtures, and polling for async background work
const { pool } = require('../src/config/database');

async function resetDb() {
  // CASCADE clears every table that references workshops (calls, customers, bookings, ...)
  await pool.query('TRUNCATE workshops, users, webhook_events RESTART IDENTITY CASCADE');
}

async function createWorkshop(overrides = {}) {
  const w = {
    name: 'Test Auto Repair',
    email: `shop-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    phone: '+15550000000',
    vapi_phone_number: '+15551112222',
    timezone: 'America/New_York', // every shop must state its own (US timezones, with DST)
    ...overrides
  };
  const { rows } = await pool.query(
    `INSERT INTO workshops (name, email, phone, vapi_phone_number, timezone)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [w.name, w.email, w.phone, w.vapi_phone_number, w.timezone]
  );
  return rows[0];
}

async function waitFor(fn, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { pool, resetDb, createWorkshop, waitFor, sleep };
