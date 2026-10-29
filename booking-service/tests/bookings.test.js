// SendGrid is mocked: tests must never send real email
jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn().mockResolvedValue([{ statusCode: 202 }])
}));

const request = require('supertest');
const sgMail = require('@sendgrid/mail');
const app = require('../src/index');
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
  scheduled_at: '2030-01-15T14:00:00Z'
});

const createBooking = (body = validBooking()) => request(app).post('/api/bookings').send(body);

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

    const res = await request(app).get('/api/bookings').query({ workshop_id: workshop.id });
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
    const res = await request(app).put(`/api/bookings/${bookingId}`).send({ status: 'completed', urgency: 'urgent' });
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({ status: 'completed', urgency: 'urgent' });
  });

  test('returns 400 when there is nothing to update', async () => {
    const res = await request(app).put(`/api/bookings/${bookingId}`).send({});
    expect(res.status).toBe(400);
  });

  test('returns 404 for an unknown booking', async () => {
    const res = await request(app).put(`/api/bookings/${UNKNOWN_ID}`).send({ status: 'completed' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/bookings/notify', () => {
  test('does not resend emails that were already sent', async () => {
    const { body } = await createBooking();
    await waitForEmails(body.booking.id);

    const res = await request(app).post('/api/bookings/notify').send({ bookingId: body.booking.id });
    expect(res.status).toBe(200);
    expect(sgMail.send).toHaveBeenCalledTimes(2); // from creation only, not 4
  });

  test('returns 500 for an unknown booking', async () => {
    const res = await request(app).post('/api/bookings/notify').send({ bookingId: UNKNOWN_ID });
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Known bugs from the Phase 0 audit. These are expected to fail today; Jest
// reports them as passing while they fail. When a fix lands in Phase 1, the
// test starts "unexpectedly passing" and must be switched to a normal test().
// ---------------------------------------------------------------------------
describe('known bugs (fixed in Phase 1)', () => {
  test.failing('GET /:id returns the booking (query selects missing calls.sentiment)', async () => {
    const { body } = await createBooking();
    await waitForEmails(body.booking.id);
    const res = await request(app).get(`/api/bookings/${body.booking.id}`);
    expect(res.status).toBe(200);
  });

  test.failing('DELETE /:id cancels the booking (bookings.cancelled_at column is missing)', async () => {
    const { body } = await createBooking();
    await waitForEmails(body.booking.id);
    const res = await request(app).delete(`/api/bookings/${body.booking.id}`).send({ cancellation_reason: 'test' });
    expect(res.status).toBe(200);
  });

  test.failing('reminders job exports sendReminders (file is a copy of routes/bookings.js)', () => {
    expect(typeof require('../src/jobs/reminders').sendReminders).toBe('function');
  });
});
