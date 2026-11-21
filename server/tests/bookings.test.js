// SendGrid is mocked: tests must never send real email
jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn().mockResolvedValue([{ statusCode: 202 }])
}));

const request = require('supertest');
const sgMail = require('@sendgrid/mail');
const app = require('../src/app');
const api = request.agent(app).set('x-api-key', process.env.API_KEY); // /api routes need the key
const { pool, resetDb, createWorkshop, waitFor } = require('./helpers');

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

let workshop;

const validBooking = () => ({
  workshop_id: workshop.id,
  customer_name: 'Jane Doe',
  customer_phone: '+15559998888',
  customer_email: 'jane@example.com',
  vehicle_make: 'Toyota',
  vehicle_model: 'Corolla',
  vehicle_year: 2018,
  issue_summary: 'Grinding noise when braking',
  issue_category: 'brakes',
  scheduled_at: '2030-01-15T09:00:00Z' // 2:00 PM in Karachi, inside opening hours
});

const createBooking = (body = validBooking()) => api.post('/api/bookings').send(body);

const emailFlags = async (id) =>
  (await pool.query('SELECT customer_email_sent, workshop_email_sent FROM bookings WHERE id = $1', [id])).rows[0];

const waitForEmails = (id) =>
  waitFor(async () => {
    const f = await emailFlags(id);
    return f.customer_email_sent && f.workshop_email_sent;
  });

beforeEach(async () => {
  await resetDb();
  sgMail.send.mockClear();
  workshop = await createWorkshop();
});

afterAll(() => pool.end());

describe('POST /api/bookings', () => {
  test('rejects a booking with missing required fields', async () => {
    const res = await createBooking({ workshop_id: workshop.id });
    expect(res.status).toBe(400);
  });

  test('creates a confirmed booking, customer and vehicle, then emails customer and workshop', async () => {
    const res = await createBooking();
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ workshop_id: workshop.id, status: 'confirmed', urgency: 'normal' });

    await waitForEmails(res.body.booking.id);
    expect(sgMail.send).toHaveBeenCalledTimes(2);
    const recipients = sgMail.send.mock.calls.map(([msg]) => msg.to);
    expect(recipients).toEqual(expect.arrayContaining(['jane@example.com', workshop.email]));
  });

  test('escapes caller-provided text in email HTML but keeps the plain-text version readable', async () => {
    const res = await createBooking({
      ...validBooking(),
      customer_name: '<script>alert(1)</script> O\'Brien',
      issue_summary: 'Brakes <img src=x onerror=alert(1)>',
      urgency: 'urgent'
    });
    await waitForEmails(res.body.booking.id);

    for (const [msg] of sgMail.send.mock.calls) {
      expect(typeof msg.html).toBe('string');
      expect(msg.html).not.toMatch(/<script|<img/);
      expect(msg.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; O&#39;Brien');
      expect(msg.text).toContain('<script>alert(1)</script> O\'Brien');
    }
    // the urgent block is trusted template HTML, so it must still render as markup
    const workshopMsg = sgMail.send.mock.calls.map(([m]) => m).find((m) => m.to === workshop.email);
    expect(workshopMsg.html).toContain('<div class="detail-row urgent">');
  });

  test('emails show the appointment in the shop\'s timezone, not the server\'s', async () => {
    // 09:00 UTC is 2:00 PM in Karachi (UTC+5); the shop default is Asia/Karachi
    const res = await createBooking({ ...validBooking(), scheduled_at: '2030-01-15T09:00:00Z' });
    await waitForEmails(res.body.booking.id);
    for (const [msg] of sgMail.send.mock.calls) {
      expect(msg.text).toContain('Tuesday, January 15, 2030 at 2:00 PM');
    }
  });

  test('reuses the existing customer for the same phone number', async () => {
    const first = await createBooking();
    const second = await createBooking();
    await waitForEmails(first.body.booking.id);
    await waitForEmails(second.body.booking.id);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM customers WHERE workshop_id = $1', [workshop.id]);
    expect(rows[0].n).toBe(1);
  });
});

describe('GET /api/bookings', () => {
  test('lists bookings filtered by workshop with a total', async () => {
    const other = await createWorkshop();
    const mine = await createBooking();
    const theirs = await createBooking({ ...validBooking(), workshop_id: other.id });
    await waitForEmails(mine.body.booking.id);
    await waitForEmails(theirs.body.booking.id);

    const res = await api.get('/api/bookings').query({ workshop_id: workshop.id });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.bookings[0]).toMatchObject({ workshop_id: workshop.id, customer_name: 'Jane Doe', vehicle_make: 'Toyota' });
  });
});

describe('PUT /api/bookings/:id', () => {
  let bookingId;

  beforeEach(async () => {
    const { body } = await createBooking();
    bookingId = body.booking.id;
    await waitForEmails(bookingId);
  });

  test('updates allowed fields', async () => {
    const res = await api.put(`/api/bookings/${bookingId}`).send({ status: 'completed', urgency: 'urgent' });
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ status: 'completed', urgency: 'urgent' });
  });

  test('returns 400 when there is nothing to update', async () => {
    const res = await api.put(`/api/bookings/${bookingId}`).send({});
    expect(res.status).toBe(400);
  });

  test('returns 404 for an unknown booking', async () => {
    const res = await api.put(`/api/bookings/${UNKNOWN_ID}`).send({ status: 'completed' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/bookings/notify', () => {
  test('does not resend emails that were already sent', async () => {
    const { body } = await createBooking();
    await waitForEmails(body.booking.id);

    const res = await api.post('/api/bookings/notify').send({ bookingId: body.booking.id });
    expect(res.status).toBe(200);
    expect(sgMail.send).toHaveBeenCalledTimes(2); // from creation only, not 4
  });

  test('returns 500 for an unknown booking', async () => {
    const res = await api.post('/api/bookings/notify').send({ bookingId: UNKNOWN_ID });
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Known bugs from the Phase 0 audit. These are expected to fail today; Jest
// reports them as passing while they fail. When a fix lands in Phase 1, the
// test starts "unexpectedly passing" and must be switched to a normal test().
// ---------------------------------------------------------------------------
describe('known bugs (fixed in Phase 1)', () => {
  test('GET /:id returns the booking with customer, vehicle and shop details', async () => {
    const { body } = await createBooking();
    await waitForEmails(body.booking.id);
    const res = await api.get(`/api/bookings/${body.booking.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: body.booking.id,
      customer_name: 'Jane Doe',
      vehicle_make: 'Toyota',
      workshop_timezone: 'Asia/Karachi',
      sentiment: null // a manual booking has no call
    });
  });

  test('GET /:id returns 404 for a malformed id instead of a 500', async () => {
    const res = await api.get('/api/bookings/not-a-uuid');
    expect(res.status).toBe(404);
  });

  test('DELETE /:id cancels the booking and records when and why', async () => {
    const { body } = await createBooking();
    await waitForEmails(body.booking.id);
    const res = await api.delete(`/api/bookings/${body.booking.id}`).send({ cancellation_reason: 'Customer called back' });
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ status: 'cancelled', cancellation_reason: 'Customer called back' });
    expect(res.body.booking.cancelled_at).not.toBeNull();
  });

  test('cancelling twice keeps the original cancellation time and reason', async () => {
    const { body } = await createBooking();
    await waitForEmails(body.booking.id);
    const first = await api.delete(`/api/bookings/${body.booking.id}`).send({ cancellation_reason: 'first' });
    const second = await api.delete(`/api/bookings/${body.booking.id}`).send({ cancellation_reason: 'second' });
    expect(second.status).toBe(200);
    expect(second.body.booking.cancelled_at).toBe(first.body.booking.cancelled_at);
    expect(second.body.booking.cancellation_reason).toBe('first');
  });

  test('PUT can still cancel a booking, and records when', async () => {
    const { body } = await createBooking();
    await waitForEmails(body.booking.id);
    const res = await api.put(`/api/bookings/${body.booking.id}`).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('cancelled');
    expect(res.body.booking.cancelled_at).not.toBeNull();
  });

  test('PUT rejects an unknown status with a clear 400 instead of storing it', async () => {
    const { body } = await createBooking();
    await waitForEmails(body.booking.id);
    const res = await api.put(`/api/bookings/${body.booking.id}`).send({ status: 'done' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be one of/);
  });

  test('a completed booking cannot be cancelled', async () => {
    const { body } = await createBooking();
    await waitForEmails(body.booking.id);
    await api.put(`/api/bookings/${body.booking.id}`).send({ status: 'completed' });
    const res = await api.delete(`/api/bookings/${body.booking.id}`);
    expect(res.status).toBe(409);
  });

  test('DELETE /:id returns 404 for an unknown booking', async () => {
    const res = await api.delete(`/api/bookings/${UNKNOWN_ID}`);
    expect(res.status).toBe(404);
  });

  test('DELETE /:id works without a reason', async () => {
    const { body } = await createBooking();
    await waitForEmails(body.booking.id);
    const res = await api.delete(`/api/bookings/${body.booking.id}`);
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ status: 'cancelled', cancellation_reason: null });
  });

  test.failing('reminders job exports sendReminders (file is a copy of routes/bookings.js)', () => {
    expect(typeof require('../src/jobs/reminders').sendReminders).toBe('function');
  });
});

describe('POST /api/bookings: scheduling and data rules', () => {
  const at = (time) => ({ ...validBooking(), scheduled_at: time });

  test('a full time returns 409 with other times the customer can pick', async () => {
    await createBooking(); // the shop has 2 bays
    await createBooking({ ...validBooking(), customer_phone: '+15550001111' });
    const res = await createBooking({ ...validBooking(), customer_phone: '+15550002222' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLOT_FULL');
    expect(res.body.alternatives.length).toBeGreaterThan(0);
    expect(res.body.alternatives.map((a) => a.start)).not.toContain('2030-01-15T09:00:00.000Z');
    expect(res.body.alternatives[0].local).toMatch(/January 15 at 3:00 PM/); // next free hour
  });

  test.each([
    ['after closing time', '2030-01-15T14:00:00Z', 'OUTSIDE_HOURS'], // 7 PM Karachi
    ['on a closed day', '2030-01-13T06:00:00Z', 'CLOSED'], // Sunday
    ['in the past', '2020-01-15T09:00:00Z', 'PAST']
  ])('a time %s returns 422 with alternatives', async (_, time, code) => {
    const res = await createBooking(at(time));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe(code);
    expect(res.body.alternatives.length).toBeGreaterThan(0);
    expect(await pool.query('SELECT 1 FROM bookings')).toHaveProperty('rowCount', 0);
  });

  test('invalid fields are all reported in one 400', async () => {
    const res = await createBooking({ ...validBooking(), customer_phone: 'call me', scheduled_at: 'soon' });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(expect.arrayContaining([
      expect.stringMatching(/customer_phone/),
      expect.stringMatching(/scheduled_at/)
    ]));
  });

  test('an unknown workshop returns 404', async () => {
    const res = await createBooking({ ...validBooking(), workshop_id: UNKNOWN_ID });
    expect(res.status).toBe(404);
  });

  test('a suspended workshop does not take bookings', async () => {
    await pool.query("UPDATE workshops SET status = 'suspended' WHERE id = $1", [workshop.id]);
    const res = await createBooking();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WORKSHOP_INACTIVE');
  });

  test('the same phone written differently is the same customer', async () => {
    const first = await createBooking({ ...validBooking(), customer_phone: '+1 555 999-8888' });
    const second = await createBooking({ ...validBooking(), customer_phone: '+15559998888', scheduled_at: '2030-01-16T09:00:00Z' });
    expect(second.body.booking.customer_id).toBe(first.body.booking.customer_id);
    const { rows } = await pool.query('SELECT phone FROM customers');
    expect(rows).toEqual([{ phone: '+15559998888' }]);
  });

  test('the same car is reused instead of duplicated', async () => {
    const first = await createBooking();
    const second = await createBooking({ ...validBooking(), vehicle_make: 'toyota', scheduled_at: '2030-01-16T09:00:00Z' });
    expect(second.body.booking.vehicle_id).toBe(first.body.booking.vehicle_id);
    expect((await pool.query('SELECT 1 FROM vehicles')).rowCount).toBe(1);
  });

  test('a different car for the same customer gets its own record', async () => {
    const first = await createBooking();
    const second = await createBooking({ ...validBooking(), vehicle_model: 'Civic', vehicle_make: 'Honda', scheduled_at: '2030-01-16T09:00:00Z' });
    expect(second.body.booking.vehicle_id).not.toBe(first.body.booking.vehicle_id);
  });

  test('unexpected category and urgency values fall back to safe defaults', async () => {
    const res = await createBooking({ ...validBooking(), issue_category: 'Weird Noise', urgency: 'ASAP!!' });
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ issue_category: 'other', urgency: 'normal' });
  });

  test('an impossible vehicle year is dropped, not stored', async () => {
    const res = await createBooking({ ...validBooking(), vehicle_year: 3020 });
    const { rows } = await pool.query('SELECT year FROM vehicles WHERE id = $1', [res.body.booking.vehicle_id]);
    expect(rows[0].year).toBeNull();
  });
});
