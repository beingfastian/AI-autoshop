// SendGrid is mocked: tests must never send real email
jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn().mockResolvedValue([{ statusCode: 202 }])
}));

const request = require('supertest');
const sgMail = require('@sendgrid/mail');
const app = require('../src/app');
const { pool, resetDb, createWorkshop, waitFor, sleep } = require('./helpers');

const AUTH = 'Bearer test-webhook-secret';

let workshop;
let callId;

beforeEach(async () => {
  await resetDb();
  workshop = await createWorkshop();
  const res = await request(app)
    .post('/api/calls/inbound')
    .set('x-api-key', process.env.API_KEY)
    .send({ from: '+15559998888', to: workshop.vapi_phone_number, callSid: 'CA-1' });
  callId = res.body.call_id;
});

afterAll(() => pool.end());

const structuredData = {
  customer_name: 'Jane Doe',
  customer_phone: '+15559998888',
  customer_email: 'jane@example.com',
  vehicle_make: 'Toyota',
  vehicle_model: 'Corolla',
  vehicle_year: 2018,
  issue_summary: 'Grinding noise when braking',
  issue_category: 'brakes',
  urgency: 'normal',
  preferred_date: '2030-01-15',
  preferred_time: '14:00',
  booking_confirmed: true
};

function endOfCallReport(data = structuredData) {
  return {
    message: {
      type: 'end-of-call-report',
      call: { id: 'vapi-call-1', metadata: { call_id: callId, workshop_id: workshop.id } },
      analysis: { structuredData: data }
    }
  };
}

const postCallEnded = (body, auth = AUTH) =>
  request(app).post('/api/webhooks/vapi/call-ended').set('Authorization', auth).send(body);

const bookingsForCall = async () =>
  (await pool.query('SELECT * FROM bookings WHERE call_id = $1', [callId])).rows;

const waitForBooking = () =>
  waitFor(async () => {
    const rows = await bookingsForCall();
    return rows.length ? rows : null;
  });

describe('POST /api/webhooks/vapi/call-ended', () => {
  test('rejects requests without the webhook secret', async () => {
    const res = await postCallEnded(endOfCallReport(), 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  test('acknowledges and ignores events without metadata.call_id', async () => {
    const res = await postCallEnded({ message: { type: 'end-of-call-report', call: {} } });
    expect(res.status).toBe(200);
  });

  test('completes the call, saves analysis and creates a confirmed booking', async () => {
    const res = await postCallEnded(endOfCallReport());
    expect(res.status).toBe(200);

    const [booking] = await waitForBooking();
    expect(booking).toMatchObject({
      workshop_id: workshop.id,
      status: 'confirmed',
      issue_summary: 'Grinding noise when braking',
      issue_category: 'brakes'
    });

    const call = (await pool.query('SELECT * FROM calls WHERE id = $1', [callId])).rows[0];
    expect(call.status).toBe('completed');

    const analysis = (await pool.query('SELECT * FROM call_analysis WHERE call_id = $1', [callId])).rows[0];
    expect(analysis).toMatchObject({ customer_name: 'Jane Doe', vehicle_make: 'Toyota', booking_created: true });

    const customer = (await pool.query('SELECT * FROM customers WHERE id = $1', [booking.customer_id])).rows[0];
    expect(customer).toMatchObject({ name: 'Jane Doe', phone: '+15559998888', email: 'jane@example.com' });
  });

  test('does not create a booking when the customer did not confirm', async () => {
    await postCallEnded(endOfCallReport({ ...structuredData, booking_confirmed: false }));
    await waitFor(async () =>
      (await pool.query('SELECT 1 FROM call_analysis WHERE call_id = $1', [callId])).rowCount
    );
    expect(await bookingsForCall()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Known bugs from the Phase 0 audit. These are expected to fail today; Jest
// reports them as passing while they fail. When a fix lands in Phase 1, the
// test starts "unexpectedly passing" and must be switched to a normal test().
// ---------------------------------------------------------------------------
describe('known bugs (fixed in Phase 1)', () => {
  test('books the slot the customer asked for, not a hardcoded tomorrow 10:00', async () => {
    await postCallEnded(endOfCallReport());
    const [booking] = await waitForBooking();
    expect(booking.scheduled_at.toISOString().slice(0, 10)).toBe('2030-01-15');
  });

  test('a retried end-of-call webhook does not create a duplicate booking', async () => {
    await postCallEnded(endOfCallReport());
    await postCallEnded(endOfCallReport());
    await waitForBooking();
    await sleep(500);
    expect(await bookingsForCall()).toHaveLength(1);
  });

  test.failing('accepts the secret in the X-Vapi-Secret header Vapi sends by default', async () => {
    const res = await request(app)
      .post('/api/webhooks/vapi/call-ended')
      .set('X-Vapi-Secret', 'test-webhook-secret')
      .send(endOfCallReport());
    expect(res.status).toBe(200);
  });

  test('call-started marks the call in-progress and records when it was answered', async () => {
    await request(app)
      .post('/api/webhooks/vapi/call-started')
      .set('Authorization', AUTH)
      .send({ message: { type: 'status-update', call: { metadata: { call_id: callId } } } });
    const call = (await pool.query('SELECT status, answered_at FROM calls WHERE id = $1', [callId])).rows[0];
    expect(call.status).toBe('in-progress');
    expect(call.answered_at).toBeInstanceOf(Date);
  });
});

describe('phone bookings', () => {
  const analysisFor = () =>
    waitFor(async () => (await pool.query('SELECT * FROM call_analysis WHERE call_id = $1', [callId])).rows[0]);

  beforeEach(() => sgMail.send.mockClear());

  test('a phone booking emails the customer and the shop', async () => {
    await postCallEnded(endOfCallReport());
    await waitFor(() => sgMail.send.mock.calls.length === 2);
    const recipients = sgMail.send.mock.calls.map(([m]) => m.to);
    expect(recipients).toEqual(expect.arrayContaining(['jane@example.com', workshop.email]));
  });

  test('a retried webhook is handled cleanly: no second booking, no second email, no error', async () => {
    await postCallEnded(endOfCallReport());
    await waitFor(() => sgMail.send.mock.calls.length === 2);
    const error = jest.spyOn(console, 'error');
    await postCallEnded(endOfCallReport());
    await sleep(500);
    expect(await bookingsForCall()).toHaveLength(1);
    expect(sgMail.send).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  test('a time the AI could not pin down is not guessed: no booking, callback requested', async () => {
    await postCallEnded(endOfCallReport({ ...structuredData, preferred_date: 'next Tuesday', preferred_time: 'afternoon' }));
    const analysis = await analysisFor();
    expect(analysis).toMatchObject({ booking_created: false, callback_requested: true });
    expect(await bookingsForCall()).toHaveLength(0);
    const call = (await pool.query('SELECT status FROM calls WHERE id = $1', [callId])).rows[0];
    expect(call.status).toBe('completed'); // the call itself is still saved
  });

  test('a requested time that is already full means a callback, not an overbooking', async () => {
    const book = (phone) =>
      request(app).post('/api/bookings').set('x-api-key', process.env.API_KEY).send({
        workshop_id: workshop.id, customer_name: 'Other', customer_phone: phone,
        issue_summary: 'x', scheduled_at: '2030-01-15T09:00:00Z' // 14:00 Karachi, same as the call
      });
    expect((await book('+15550001111')).status).toBe(201);
    expect((await book('+15550002222')).status).toBe(201);

    await postCallEnded(endOfCallReport());
    const analysis = await analysisFor();
    expect(analysis).toMatchObject({ booking_created: false, callback_requested: true });
    expect(await bookingsForCall()).toHaveLength(0);
  });

  test('missing booking details mean a callback, and the call is still saved', async () => {
    await postCallEnded(endOfCallReport({ ...structuredData, customer_name: '' }));
    expect(await analysisFor()).toMatchObject({ booking_created: false, callback_requested: true });
  });

  test('when the AI missed the phone number, the caller ID is used', async () => {
    await postCallEnded(endOfCallReport({ ...structuredData, customer_phone: null }));
    const [booking] = await waitForBooking();
    const customer = (await pool.query('SELECT phone FROM customers WHERE id = $1', [booking.customer_id])).rows[0];
    expect(customer.phone).toBe('+15559998888'); // the number the call came from
  });

  test('the booking is linked to the call and shows its sentiment', async () => {
    await postCallEnded({
      message: { ...endOfCallReport().message, analysis: { structuredData, sentiment: { label: 'positive' } } }
    });
    const [booking] = await waitForBooking();
    const res = await request(app).get(`/api/bookings/${booking.id}`).set('x-api-key', process.env.API_KEY);
    expect(res.body).toMatchObject({ call_id: callId, sentiment: 'positive' });
  });

  test('a report for an unknown call is ignored without storing anything', async () => {
    const unknown = '00000000-0000-0000-0000-000000000000';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await postCallEnded({
      message: { type: 'end-of-call-report', call: { metadata: { call_id: unknown } }, analysis: { structuredData } }
    });
    expect(res.status).toBe(200);
    await waitFor(() => warn.mock.calls.some(([m]) => /unknown call/.test(m)));
    expect((await pool.query('SELECT 1 FROM call_analysis')).rowCount).toBe(0);
    warn.mockRestore();
  });

  test('a malformed call id is acknowledged and ignored', async () => {
    const res = await postCallEnded({ message: { type: 'end-of-call-report', call: { metadata: { call_id: 'abc' } } } });
    expect(res.status).toBe(200);
  });
});
