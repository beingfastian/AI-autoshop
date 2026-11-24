// List endpoints the dashboard relies on: filters, totals, ordering, paging limits, and what
// fields come back. (A dropped "$" in the count query once turned a filter into "status = 2".)
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: jest.fn().mockResolvedValue([{ statusCode: 202, headers: {} }]) }));

const request = require('supertest');
const app = require('../src/app');
const { pool, resetDb, createWorkshop } = require('./helpers');

const admin = request.agent(app).set('x-api-key', process.env.API_KEY);
let shop;

// Tue Jan 15 / Wed Jan 16 / Thu Jan 17 2030, 2:00 PM New York
const TIMES = ['2030-01-15T19:00:00Z', '2030-01-16T19:00:00Z', '2030-01-17T19:00:00Z'];

async function book(at, phone) {
  const res = await admin.post('/api/bookings').send({
    workshop_id: shop.id, customer_name: 'Jane', customer_phone: phone, issue_summary: 'Brakes', scheduled_at: at
  });
  expect(res.status).toBe(201);
  return res.body.booking;
}

beforeEach(async () => {
  await resetDb();
  shop = await createWorkshop();
});

afterAll(() => pool.end());

describe('GET /api/bookings', () => {
  test('date and status filters apply to both the list and the total', async () => {
    const [first] = [await book(TIMES[0], '+15550000001'), await book(TIMES[1], '+15550000002'), await book(TIMES[2], '+15550000003')];
    await admin.delete(`/api/bookings/${first.id}`);

    const upcoming = await admin.get(`/api/bookings?workshop_id=${shop.id}&date_from=2030-01-16T00:00:00Z`);
    expect(upcoming.body.bookings).toHaveLength(2);
    expect(upcoming.body.total).toBe(2);

    const cancelled = await admin.get(`/api/bookings?workshop_id=${shop.id}&status=cancelled`);
    expect(cancelled.body.bookings.map((b) => b.id)).toEqual([first.id]);
    expect(cancelled.body.total).toBe(1);

    const past = await admin.get(`/api/bookings?workshop_id=${shop.id}&date_to=2030-01-16T23:59:59Z&status=confirmed`);
    expect(past.body.total).toBe(1);
  });

  test('newest first by default; sort=asc gives the soonest first', async () => {
    for (const [i, t] of TIMES.entries()) await book(t, `+1555000000${i}`);
    const desc = await admin.get(`/api/bookings?workshop_id=${shop.id}`);
    const asc = await admin.get(`/api/bookings?workshop_id=${shop.id}&sort=asc&limit=1`);
    expect(desc.body.bookings.map((b) => b.scheduled_at)).toEqual([...TIMES].reverse().map((t) => new Date(t).toISOString()));
    expect(asc.body.bookings.map((b) => b.scheduled_at)).toEqual([new Date(TIMES[0]).toISOString()]);
    expect(asc.body.total).toBe(3);
  });

  test('page size is clamped and nonsense paging values fall back to defaults', async () => {
    const huge = await admin.get(`/api/bookings?workshop_id=${shop.id}&limit=1000000&offset=-5`);
    expect(huge.body).toMatchObject({ limit: 200, offset: 0 });
    const junk = await admin.get(`/api/bookings?workshop_id=${shop.id}&limit=abc`);
    expect(junk.status).toBe(200);
    expect(junk.body.limit).toBe(50);
  });

  test('an invalid date filter is a clear 400, not a server error', async () => {
    const res = await admin.get('/api/bookings?date_from=next-tuesday');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/date_from/);
  });
});

describe('GET /api/calls', () => {
  async function call({ transcript = 'Caller: hi\nAgent: hello', callback = false, booked = false } = {}) {
    const { rows } = await pool.query(
      `INSERT INTO calls (workshop_id, from_number, to_number, status, transcript) VALUES ($1, '+15559998888', $2, 'completed', $3) RETURNING id`,
      [shop.id, shop.ai_phone_number, transcript]
    );
    await pool.query(
      `INSERT INTO call_analysis (call_id, structured_data, customer_name, customer_phone, issue_keywords, booking_created, callback_requested)
       VALUES ($1, '{"summary":"Wants brakes checked"}', 'Jane', '+15559998888', 'Brakes grinding', $2, $3)`,
      [rows[0].id, booked, callback]
    );
    return rows[0].id;
  }

  test('lists include the outcome and caller details but not the transcript', async () => {
    await call({ callback: true, transcript: 'x'.repeat(50000) });
    const res = await admin.get(`/api/calls/workshop/${shop.id}`);
    expect(res.body.calls[0]).toMatchObject({
      customer_name: 'Jane', customer_phone: '+15559998888', issue_summary: 'Brakes grinding', callback_requested: true, booking_created: false
    });
    expect(res.body.calls[0]).not.toHaveProperty('transcript');
  });

  test('a single call includes the transcript, summary and caller details', async () => {
    const id = await call({ booked: true });
    const res = await admin.get(`/api/calls/${id}`);
    expect(res.body).toMatchObject({
      transcript: 'Caller: hi\nAgent: hello', customer_name: 'Jane', booking_created: true,
      structured_data: { summary: 'Wants brakes checked' }
    });
  });

  test('page size is clamped', async () => {
    const res = await admin.get(`/api/calls/workshop/${shop.id}?limit=999999`);
    expect(res.body.limit).toBe(200);
  });
});
