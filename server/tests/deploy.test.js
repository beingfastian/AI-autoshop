// Hosting on Vercel + Neon: jobs over HTTP, DATABASE_URL, proxy-aware login limits, entry point.
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: jest.fn().mockResolvedValue([{ statusCode: 202, headers: {} }]) }));

const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');
const sgMail = require('@sendgrid/mail');
const app = require('../src/app');
const { validateEnv } = require('../src/config/env');
const { pool, resetDb, createWorkshop } = require('./helpers');

const SECRET = 'c'.repeat(40);

afterAll(() => pool.end());

test('tests run against a _test database, never the real one (even with DATABASE_URL in .env)', async () => {
  const { rows } = await pool.query('SELECT current_database() AS db');
  expect(rows[0].db).toMatch(/_test$/);
});

describe('GET/POST /api/jobs/tick', () => {
  const saved = process.env.CRON_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  test('is switched off (503) until CRON_SECRET is set', async () => {
    delete process.env.CRON_SECRET;
    expect((await request(app).get('/api/jobs/tick')).status).toBe(503);
  });

  test('refuses a missing or wrong secret', async () => {
    process.env.CRON_SECRET = SECRET;
    expect((await request(app).get('/api/jobs/tick')).status).toBe(401);
    expect((await request(app).get('/api/jobs/tick').set('Authorization', 'Bearer wrong')).status).toBe(401);
    expect((await request(app).get('/api/jobs/tick').set('x-api-key', process.env.API_KEY)).status).toBe(401);
  });

  test('with the secret (GET from Vercel cron or POST from another scheduler) it runs the jobs once', async () => {
    process.env.CRON_SECRET = SECRET;
    await resetDb();
    sgMail.send.mockClear();
    const shop = await createWorkshop();
    await request(app).post('/api/bookings').set('x-api-key', process.env.API_KEY).send({
      workshop_id: shop.id, customer_name: 'Jane', customer_phone: '+15559998888', customer_email: 'jane@example.com',
      issue_summary: 'Brakes', scheduled_at: '2030-01-15T19:00:00Z'
    });

    const get = await request(app).get('/api/jobs/tick').set('Authorization', `Bearer ${SECRET}`);
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({ ok: true, notifications: { sent: 2 } });
    expect(sgMail.send).toHaveBeenCalledTimes(2);

    const post = await request(app).post('/api/jobs/tick').set('Authorization', `Bearer ${SECRET}`);
    expect(post.body.notifications.sent).toBe(0); // nothing sent twice
  });
});

describe('login limit behind proxies', () => {
  function limitedApp(env) {
    const saved = {};
    for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
    let instance;
    jest.isolateModules(() => { instance = require('../src/app'); });
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    return instance;
  }
  const attempt = (a, email, ip) => {
    const r = request(a).post('/api/auth/login').send({ email, password: 'wrong password!' });
    return (ip ? r.set('X-Forwarded-For', ip) : r).then((res) => res.status);
  };

  test('one person hammering an account does not lock out others sharing the same IP', async () => {
    const a = limitedApp({ LOGIN_RATE_LIMIT: '2' });
    expect([await attempt(a, 'one@a.test'), await attempt(a, 'one@a.test'), await attempt(a, 'one@a.test')]).toEqual([401, 401, 429]);
    expect(await attempt(a, 'two@a.test')).toBe(401); // a different account from the same IP still gets through
  });

  test('behind a trusted proxy the limit follows the real client IP from X-Forwarded-For', async () => {
    const a = limitedApp({ LOGIN_RATE_LIMIT: '1', TRUST_PROXY: 'true' });
    expect(await attempt(a, 'x@a.test', '203.0.113.1')).toBe(401);
    expect(await attempt(a, 'x@a.test', '203.0.113.1')).toBe(429);
    expect(await attempt(a, 'x@a.test', '203.0.113.2')).toBe(401); // another client is not affected
  });
});

describe('configuration for hosting', () => {
  const VALID = {
    API_KEY: 'k'.repeat(32), VOICE_AGENT_KEY: 'v'.repeat(32), SENDGRID_API_KEY: 'SG.abc', SENDGRID_FROM_EMAIL: 'noreply@example.com'
  };

  test('DATABASE_URL, CRON_SECRET and TRUST_PROXY are checked when given', () => {
    expect(() => validateEnv({ ...VALID, DATABASE_URL: 'postgresql://u:p@ep-x.neon.tech/db?sslmode=require', CRON_SECRET: SECRET, TRUST_PROXY: '1' })).not.toThrow();
    let message = '';
    try { validateEnv({ ...VALID, DATABASE_URL: 'mysql://x', CRON_SECRET: 'short', TRUST_PROXY: 'yes' }); } catch (e) { message = e.message; }
    expect(message).toMatch(/DATABASE_URL must start with postgres/);
    expect(message).toMatch(/CRON_SECRET must be at least 32 characters/);
    expect(message).toMatch(/TRUST_PROXY must be true, false or a number/);
  });

  test('the pool uses DATABASE_URL when set', () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://u:p@ep-x.neon.tech/db?sslmode=require';
    let db;
    jest.isolateModules(() => { db = require('../src/config/database'); });
    process.env.DATABASE_URL = saved;
    expect(db.pool.options.connectionString).toBe('postgresql://u:p@ep-x.neon.tech/db?sslmode=require');
    return db.pool.end();
  });

  test('the Vercel entry point refuses to load with missing settings', () => {
    const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(__dirname, '..', 'index.js'))})`], {
      cwd: os.tmpdir(), env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }, encoding: 'utf8', timeout: 20000
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Invalid environment configuration[\s\S]*API_KEY is missing/);
  });
});
