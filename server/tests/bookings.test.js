// SendGrid is mocked: tests must never send real email
jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn().mockResolvedValue([{ statusCode: 202 }])
}));

const request = require('supertest');
const sgMail = require('@sendgrid/mail');
const app = require('../src/app');
const api = request.agent(app).set('x-api-key', process.env.API_KEY); // /api routes need the key
const { pool, resetDb, createWorkshop } = require('./helpers');
const { sendDueNotifications } = require('../src/services/notifications');

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
  scheduled_at: '2030-01-15T19:00:00Z' // 2:00 PM in New York, inside opening hours
});

const createBooking = (body = validBooking()) => api.post('/api/bookings').send(body);

// Sends queued messages the way the worker does (the API only queues them)
const quiet = { log() {}, warn() {}, error() {} };
const deliverEmails = () => sendDueNotifications({ logger: quiet });

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

    await deliverEmails();
    expect(sgMail.send).toHaveBeenCalledTimes(2);
    const recipients = sgMail.send.mock.calls.map(([msg]) => msg.to);
    expect(recipients).toEqual(expect.arrayContaining(['jane@example.com', workshop.email]));
  });

  test('escapes caller-provided text in email HTML but keeps the plain-text version readable', async () => {
    await createBooking({
      ...validBooking(),
      customer_name: '<script>alert(1)</script> O\'Brien',
      issue_summary: 'Brakes <img src=x onerror=alert(1)>',
      urgency: 'urgent'
    });
    await deliverEmails();

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
    // 19:00 UTC is 2:00 PM in New York (UTC-5 in January); the server runs in UTC
    await createBooking({ ...validBooking(), scheduled_at: '2030-01-15T19:00:00Z' });
    await deliverEmails();
    for (const [msg] of sgMail.send.mock.calls) {
      expect(msg.text).toContain('Tuesday, January 15, 2030 at 2:00 PM');
    }
  });

  test('reuses the existing customer for the same phone number', async () => {
    await createBooking();
    await createBooking();
    await deliverEmails();
    await deliverEmails();

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM customers WHERE workshop_id = $1', [workshop.id]);
    expect(rows[0].n).toBe(1);
  });
});

describe('GET /api/bookings', () => {
  test('lists bookings filtered by workshop with a total', async () => {
    const other = await createWorkshop();
    await createBooking();
    await createBooking({ ...validBooking(), workshop_id: other.id });
    await deliverEmails();
    await deliverEmails();

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
    await deliverEmails();
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

describe('confirmation emails', () => {
  test('are queued with the booking and never resent by later sender runs', async () => {
    await createBooking();
    expect(sgMail.send).not.toHaveBeenCalled(); // the API only queues; the worker sends
    await deliverEmails();
    await deliverEmails();
    expect(sgMail.send).toHaveBeenCalledTimes(2);
  });

  test('the removed /notify endpoint no longer exists', async () => {
    const res = await api.post('/api/bookings/notify').send({ bookingId: UNKNOWN_ID });
    expect(res.status).toBe(404);
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
    await deliverEmails();
    const res = await api.get(`/api/bookings/${body.booking.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: body.booking.id,
      customer_name: 'Jane Doe',
      vehicle_make: 'Toyota',
      workshop_timezone: 'America/New_York',
      sentiment: null // a manual booking has no call
    });
  });

  test('GET /:id returns 404 for a malformed id instead of a 500', async () => {
    const res = await api.get('/api/bookings/not-a-uuid');
    expect(res.status).toBe(404);
  });

  test('DELETE /:id cancels the booking and records when and why', async () => {
    const { body } = await createBooking();
    await deliverEmails();
    const res = await api.delete(`/api/bookings/${body.booking.id}`).send({ cancellation_reason: 'Customer called back' });
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ status: 'cancelled', cancellation_reason: 'Customer called back' });
    expect(res.body.booking.cancelled_at).not.toBeNull();
  });

  test('cancelling twice keeps the original cancellation time and reason', async () => {
    const { body } = await createBooking();
    await deliverEmails();
    const first = await api.delete(`/api/bookings/${body.booking.id}`).send({ cancellation_reason: 'first' });
    const second = await api.delete(`/api/bookings/${body.booking.id}`).send({ cancellation_reason: 'second' });
    expect(second.status).toBe(200);
    expect(second.body.booking.cancelled_at).toBe(first.body.booking.cancelled_at);
    expect(second.body.booking.cancellation_reason).toBe('first');
  });

  test('PUT can still cancel a booking, and records when', async () => {
    const { body } = await createBooking();
    await deliverEmails();
    const res = await api.put(`/api/bookings/${body.booking.id}`).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('cancelled');
    expect(res.body.booking.cancelled_at).not.toBeNull();
  });

  test('PUT rejects an unknown status with a clear 400 instead of storing it', async () => {
    const { body } = await createBooking();
    await deliverEmails();
    const res = await api.put(`/api/bookings/${body.booking.id}`).send({ status: 'done' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be one of/);
  });

  test('a completed booking cannot be cancelled', async () => {
    const { body } = await createBooking();
    await deliverEmails();
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
    await deliverEmails();
    const res = await api.delete(`/api/bookings/${body.booking.id}`);
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ status: 'cancelled', cancellation_reason: null });
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
    expect(res.body.alternatives.map((a) => a.start)).not.toContain('2030-01-15T19:00:00.000Z');
    expect(res.body.alternatives[0].local).toMatch(/January 15 at 3:00 PM/); // next free hour
  });

  test.each([
    ['after closing time', '2030-01-16T00:00:00Z', 'OUTSIDE_HOURS'], // 7 PM New York
    ['on a closed day', '2030-01-13T16:00:00Z', 'CLOSED'], // Sunday
    ['in the past', '2020-01-15T19:00:00Z', 'PAST']
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
    const second = await createBooking({ ...validBooking(), customer_phone: '+15559998888', scheduled_at: '2030-01-16T19:00:00Z' });
    expect(second.body.booking.customer_id).toBe(first.body.booking.customer_id);
    const { rows } = await pool.query('SELECT phone FROM customers');
    expect(rows).toEqual([{ phone: '+15559998888' }]);
  });

  test('the same car is reused instead of duplicated', async () => {
    const first = await createBooking();
    const second = await createBooking({ ...validBooking(), vehicle_make: 'toyota', scheduled_at: '2030-01-16T19:00:00Z' });
    expect(second.body.booking.vehicle_id).toBe(first.body.booking.vehicle_id);
    expect((await pool.query('SELECT 1 FROM vehicles')).rowCount).toBe(1);
  });

  test('a different car for the same customer gets its own record', async () => {
    const first = await createBooking();
    const second = await createBooking({ ...validBooking(), vehicle_model: 'Civic', vehicle_make: 'Honda', scheduled_at: '2030-01-16T19:00:00Z' });
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

describe('PUT /api/bookings/:id: moving and re-opening use the same slot rules', () => {
  const put = (id, body) => api.put(`/api/bookings/${id}`).send(body);
  const other = (phone, at = '2030-01-16T19:00:00Z') =>
    createBooking({ ...validBooking(), customer_phone: phone, scheduled_at: at });

  test('moving to a free time works', async () => {
    const { body } = await createBooking();
    const res = await put(body.booking.id, { scheduled_at: '2030-01-16T19:00:00Z' });
    expect(res.status).toBe(200);
    expect(res.body.booking.scheduled_at).toBe('2030-01-16T19:00:00.000Z');
  });

  test('moving onto a full time is refused with alternatives, and nothing changes', async () => {
    const { body } = await createBooking();
    await other('+15550001111');
    await other('+15550002222'); // Wednesday 2 PM now full (2 bays)
    const res = await put(body.booking.id, { scheduled_at: '2030-01-16T19:00:00Z' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLOT_FULL');
    expect(res.body.alternatives.length).toBeGreaterThan(0);
    const { rows } = await pool.query('SELECT scheduled_at FROM bookings WHERE id = $1', [body.booking.id]);
    expect(rows[0].scheduled_at.toISOString()).toBe('2030-01-15T19:00:00.000Z');
  });

  test('moving to a closed time is refused', async () => {
    const { body } = await createBooking();
    const res = await put(body.booking.id, { scheduled_at: '2030-01-13T19:00:00Z' }); // Sunday
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CLOSED');
  });

  test('a booking does not block itself when it is re-saved or nudged within its own slot', async () => {
    await pool.query('UPDATE workshops SET bay_count = 1 WHERE id = $1', [workshop.id]);
    const { body } = await createBooking();
    expect((await put(body.booking.id, { scheduled_at: '2030-01-15T19:00:00Z', urgency: 'urgent' })).status).toBe(200);
    // 2:30 PM: overlaps its own current 2:00-3:00 booking, which must not count as taking the only bay
    expect((await put(body.booking.id, { scheduled_at: '2030-01-15T19:30:00Z' })).status).toBe(200);
  });

  test('re-opening a cancelled booking is refused if its time has been taken', async () => {
    await pool.query('UPDATE workshops SET bay_count = 1 WHERE id = $1', [workshop.id]);
    const { body } = await createBooking();
    await api.delete(`/api/bookings/${body.booking.id}`);
    await other('+15550001111', '2030-01-15T19:00:00Z'); // someone else takes the freed bay
    const res = await put(body.booking.id, { status: 'confirmed' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLOT_FULL');
  });

  test('re-opening a cancelled booking clears its cancellation details', async () => {
    const { body } = await createBooking();
    await api.delete(`/api/bookings/${body.booking.id}`).send({ cancellation_reason: 'changed mind' });
    const res = await put(body.booking.id, { status: 'confirmed' });
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ status: 'confirmed', cancelled_at: null, cancellation_reason: null });
  });

  test('staff input is validated: unknown category or urgency, or an empty summary, is a 400', async () => {
    const { body } = await createBooking();
    const res = await put(body.booking.id, { issue_category: 'Weird Noise', urgency: 'ASAP', issue_summary: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.details).toHaveLength(3);
  });

  test('an invalid date is a 400', async () => {
    const { body } = await createBooking();
    expect((await put(body.booking.id, { scheduled_at: 'next week' })).status).toBe(400);
  });
});
