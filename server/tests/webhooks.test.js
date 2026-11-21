const request = require('supertest');
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
  test.failing('books the slot the customer asked for, not a hardcoded tomorrow 10:00', async () => {
    await postCallEnded(endOfCallReport());
    const [booking] = await waitForBooking();
    expect(booking.scheduled_at.toISOString().slice(0, 10)).toBe('2030-01-15');
  });

  test.failing('a retried end-of-call webhook does not create a duplicate booking', async () => {
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

  test.failing('call-started marks the call in-progress (calls.answered_at column is missing)', async () => {
    await request(app)
      .post('/api/webhooks/vapi/call-started')
      .set('Authorization', AUTH)
      .send({ message: { type: 'status-update', call: { metadata: { call_id: callId } } } });
    const call = (await pool.query('SELECT status FROM calls WHERE id = $1', [callId])).rows[0];
    expect(call.status).toBe('in-progress');
  });
});
