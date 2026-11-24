// Dashboard sign-in and shop isolation, against the real database.
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: jest.fn().mockResolvedValue([{ statusCode: 202, headers: {} }]) }));

const request = require('supertest');
const app = require('../src/app');
const { upsertUser, hashPassword, verifyPassword, MAX_FAILED_LOGINS } = require('../src/services/auth');
const { pool, resetDb, createWorkshop } = require('./helpers');

// scrypt is slow on purpose (that's what makes guessing expensive), and every test hashes passwords
// in its setup, so these tests get more than Jest's default 5 s
jest.setTimeout(30000);

const PASSWORD = 'correct horse battery';
let shopA;
let shopB;

async function signIn(email = 'owner@a.test', password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  return { agent, res };
}

async function bookingFor(shop, phone = '+15559998888') {
  const res = await request(app).post('/api/bookings').set('x-api-key', process.env.API_KEY).send({
    workshop_id: shop.id, customer_name: 'Jane', customer_phone: phone, issue_summary: 'Brakes', scheduled_at: '2030-01-15T19:00:00Z'
  });
  return res.body.booking;
}

async function callFor(shop) {
  const { rows } = await pool.query(
    `INSERT INTO calls (workshop_id, from_number, to_number) VALUES ($1, '+15559998888', $2) RETURNING id`,
    [shop.id, shop.ai_phone_number]
  );
  return rows[0].id;
}

beforeEach(async () => {
  await resetDb();
  shopA = await createWorkshop({ name: 'Shop A', email: 'a@shops.test' });
  shopB = await createWorkshop({ name: 'Shop B', email: 'b@shops.test' });
  await upsertUser({ workshopId: shopA.id, email: 'Owner@A.test', password: PASSWORD, fullName: 'Owner A' });
  await upsertUser({ workshopId: shopB.id, email: 'owner@b.test', password: PASSWORD, fullName: 'Owner B' });
});

afterAll(() => pool.end());

describe('passwords', () => {
  test('are hashed with a random salt and verified correctly', async () => {
    const one = await hashPassword(PASSWORD);
    const two = await hashPassword(PASSWORD);
    expect(one).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(one).not.toBe(two);
    expect(await verifyPassword(PASSWORD, one)).toBe(true);
    expect(await verifyPassword('wrong password!', one)).toBe(false);
  });

  test('a placeholder or foreign hash never matches (e.g. the seed user)', async () => {
    expect(await verifyPassword('anything', '$2b$10$YourHashedPasswordHere')).toBe(false);
  });

  test('short passwords are refused', async () => {
    await expect(hashPassword('short')).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });
  });
});

describe('sign-in', () => {
  test('sets an httpOnly, SameSite session cookie and returns the user (no password data)', async () => {
    const { res } = await signIn();
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: expect.any(String), email: 'owner@a.test', full_name: 'Owner A', role: 'owner', workshop_id: shopA.id });
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const stored = (await pool.query('SELECT token_hash FROM sessions')).rows[0].token_hash;
    expect(cookie).not.toContain(stored); // only the hash is stored
  });

  test('email is case-insensitive', async () => {
    expect((await signIn('OWNER@a.TEST')).res.status).toBe(200);
  });

  test('wrong password and unknown email get the same answer', async () => {
    const wrong = await signIn('owner@a.test', 'not the password');
    const unknown = await signIn('nobody@a.test', 'not the password');
    expect(wrong.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    expect(wrong.res.body).toEqual(unknown.res.body);
  });

  test(`${MAX_FAILED_LOGINS} wrong passwords lock the account, even for the right password`, async () => {
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await signIn('owner@a.test', 'not the password');
    const locked = await signIn();
    expect(locked.res.status).toBe(429);
    expect(locked.res.body.error).toMatch(/Too many failed attempts/);
  });

  test('a successful sign-in resets the failure count', async () => {
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) await signIn('owner@a.test', 'not the password');
    expect((await signIn()).res.status).toBe(200);
    const { rows } = await pool.query("SELECT failed_login_count FROM users WHERE email = 'owner@a.test'");
    expect(rows[0].failed_login_count).toBe(0);
  });

  test('a disabled user cannot sign in', async () => {
    await pool.query("UPDATE users SET status = 'disabled' WHERE email = 'owner@a.test'");
    expect((await signIn()).res.status).toBe(401);
  });

  test('too many sign-in attempts from one address are slowed down (per-IP limit)', async () => {
    let limitedApp;
    const saved = process.env.LOGIN_RATE_LIMIT;
    process.env.LOGIN_RATE_LIMIT = '3';
    jest.isolateModules(() => { limitedApp = require('../src/app'); });
    process.env.LOGIN_RATE_LIMIT = saved;
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await request(limitedApp).post('/api/auth/login').send({ email: 'x@a.test', password: 'nope nope nope' })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  test('missing fields are a 400', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'owner@a.test' })).status).toBe(400);
  });
});

describe('sessions', () => {
  test('/me returns the user and their shop', async () => {
    const { agent } = await signIn();
    const res = await agent.get('/api/auth/me');
    expect(res.body).toMatchObject({ user: { email: 'owner@a.test' }, workshop: { id: shopA.id, name: 'Shop A' } });
  });

  test('no cookie, a made-up cookie, or an expired session is a 401', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', 'session=made-up-token-made-up-token')).status).toBe(401);
    const { agent } = await signIn();
    await pool.query("UPDATE sessions SET expires_at = NOW() - interval '1 second', created_at = NOW() - interval '1 day'");
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  test('logout ends the session on the server, not just in the browser', async () => {
    const { agent, res } = await signIn();
    const cookie = res.headers['set-cookie'][0].split(';')[0];
    await agent.post('/api/auth/logout');
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  test('disabling a user ends their existing sessions', async () => {
    const { agent } = await signIn();
    await pool.query("UPDATE users SET status = 'disabled' WHERE email = 'owner@a.test'");
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  test('a password reset signs the user out everywhere', async () => {
    const { agent } = await signIn();
    await upsertUser({ workshopId: shopA.id, email: 'owner@a.test', password: 'a brand new password', fullName: 'Owner A' });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('shop isolation: staff only ever see their own shop', () => {
  test('booking list is limited to the user\'s shop, whatever workshop_id they ask for', async () => {
    await bookingFor(shopA);
    await bookingFor(shopB);
    const { agent } = await signIn();
    const res = await agent.get(`/api/bookings?workshop_id=${shopB.id}`);
    expect(res.body.bookings.map((b) => b.workshop_id)).toEqual([shopA.id]);
  });

  test('another shop\'s booking cannot be read, changed or cancelled (404, as if it did not exist)', async () => {
    const theirs = await bookingFor(shopB);
    const { agent } = await signIn();
    expect((await agent.get(`/api/bookings/${theirs.id}`)).status).toBe(404);
    expect((await agent.put(`/api/bookings/${theirs.id}`).send({ urgency: 'urgent' })).status).toBe(404);
    expect((await agent.delete(`/api/bookings/${theirs.id}`)).status).toBe(404);
    const { rows } = await pool.query('SELECT status, urgency FROM bookings WHERE id = $1', [theirs.id]);
    expect(rows[0]).toMatchObject({ status: 'confirmed', urgency: 'normal' });
  });

  test('own bookings work normally', async () => {
    const mine = await bookingFor(shopA);
    const { agent } = await signIn();
    expect((await agent.get(`/api/bookings/${mine.id}`)).status).toBe(200);
  });

  test('a new booking always goes to the user\'s own shop', async () => {
    const { agent } = await signIn();
    const res = await agent.post('/api/bookings').send({
      workshop_id: shopB.id, customer_name: 'Jane', customer_phone: '+15559998888', issue_summary: 'x', scheduled_at: '2030-01-15T19:00:00Z'
    });
    expect(res.status).toBe(201);
    expect(res.body.booking.workshop_id).toBe(shopA.id);
  });

  test('another shop\'s calls cannot be listed or read', async () => {
    const theirs = await callFor(shopB);
    const mine = await callFor(shopA);
    const { agent } = await signIn();
    expect((await agent.get(`/api/calls/${theirs}`)).status).toBe(404);
    expect((await agent.get(`/api/calls/workshop/${shopB.id}`)).status).toBe(404);
    const own = await agent.get('/api/calls');
    expect(own.body.calls.map((c) => c.id)).toEqual([mine]);
  });

  test('the admin API key still sees every shop', async () => {
    const theirs = await bookingFor(shopB);
    expect((await request(app).get(`/api/bookings/${theirs.id}`).set('x-api-key', process.env.API_KEY)).status).toBe(200);
  });
});

describe('shop settings', () => {
  test('owners can read and change their shop\'s settings', async () => {
    const { agent } = await signIn();
    expect((await agent.get('/api/workshop')).body).toMatchObject({ id: shopA.id, name: 'Shop A' });
    const res = await agent.put('/api/workshop').send({
      bay_count: 3,
      transfer_phone: '(212) 555-0100',
      notify_emails: ['Manager@A.test'],
      business_hours: { monday: { open: '08:00', close: '17:00' }, saturday: { closed: true } }
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ bay_count: 3, transfer_phone: '+12125550100', notify_emails: ['manager@a.test'] });
    expect(res.body.business_hours.monday).toEqual({ open: '08:00', close: '17:00' });
    expect(res.body.business_hours.sunday).toEqual({ closed: true }); // days not given are closed
  });

  test('bad settings are rejected with every problem listed, and nothing changes', async () => {
    const { agent } = await signIn();
    const res = await agent.put('/api/workshop').send({
      bay_count: 0,
      timezone: 'America/New_Yrok',
      business_hours: { monday: { open: '18:00', close: '08:00' } },
      notify_emails: ['not-an-email']
    });
    expect(res.status).toBe(400);
    expect(res.body.details).toHaveLength(4);
    const { rows } = await pool.query('SELECT bay_count, timezone FROM workshops WHERE id = $1', [shopA.id]);
    expect(rows[0]).toMatchObject({ bay_count: 2, timezone: 'America/New_York' });
  });

  test('staff can view settings but not change them', async () => {
    await upsertUser({ workshopId: shopA.id, email: 'staff@a.test', password: PASSWORD, fullName: 'Staff', role: 'staff' });
    const { agent } = await signIn('staff@a.test');
    expect((await agent.get('/api/workshop')).status).toBe(200);
    expect((await agent.put('/api/workshop').send({ bay_count: 5 })).status).toBe(403);
  });

  test('closures: add, list and remove; another shop\'s closure cannot be removed', async () => {
    const { agent } = await signIn();
    const added = await agent.post('/api/workshop/closures').send({ starts_on: '2030-12-24', ends_on: '2030-12-26', reason: 'Christmas' });
    expect(added.status).toBe(201);
    expect((await agent.get('/api/workshop/closures')).body.closures).toEqual([
      { id: added.body.id, starts_on: '2030-12-24', ends_on: '2030-12-26', reason: 'Christmas' }
    ]);

    const other = await signIn('owner@b.test');
    expect((await other.agent.delete(`/api/workshop/closures/${added.body.id}`)).status).toBe(404);
    expect((await agent.delete(`/api/workshop/closures/${added.body.id}`)).status).toBe(200);
  });

  test('an impossible closure is rejected', async () => {
    const { agent } = await signIn();
    expect((await agent.post('/api/workshop/closures').send({ starts_on: '2030-02-30' })).status).toBe(400);
    expect((await agent.post('/api/workshop/closures').send({ starts_on: '2030-12-26', ends_on: '2030-12-24' })).status).toBe(400);
  });
});
