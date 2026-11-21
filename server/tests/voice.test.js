// Voice agent API, against the real database. Shop: New York, Mon-Fri 8-6, 2 bays.
// 2030-01-15 is a Tuesday; 19:00Z is 2:00 PM in New York.
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: jest.fn() }));

const request = require('supertest');
const sgMail = require('@sendgrid/mail');
const app = require('../src/app');
const { TOOLS } = require('../src/services/agentConfig');
const { sendDueNotifications } = require('../src/services/notifications');
const { retryCallReports } = require('../src/services/voiceCalls');
const { pool, resetDb, createWorkshop } = require('./helpers');

const voice = request.agent(app).set('Authorization', `Bearer ${process.env.VOICE_AGENT_KEY}`);
const quiet = { log() {}, warn() {}, error() {} };
const CALLER = '+15559998888';

let workshop;

const start = (overrides = {}) =>
  voice.post('/api/voice/calls').send({ provider_call_id: 'room-1', to_number: workshop.ai_phone_number, from_number: CALLER, ...overrides });

async function answeredCall() {
  const res = await start();
  return res.body.call_id;
}

const book = (callId, args = {}) =>
  voice.post(`/api/voice/calls/${callId}/bookings`).send({
    start: '2030-01-15T19:00:00.000Z',
    customer_name: 'Jane Doe',
    customer_email: 'jane@example.com',
    vehicle_make: 'Toyota',
    vehicle_model: 'Corolla',
    issue_summary: 'Grinding noise when braking',
    issue_category: 'brakes',
    ...args
  });

async function fillSlot(at = '2030-01-15T19:00:00Z') {
  for (const phone of ['+15550001111', '+15550002222']) {
    const res = await request(app).post('/api/bookings').set('x-api-key', process.env.API_KEY).send({
      workshop_id: workshop.id, customer_name: 'Other', customer_phone: phone, issue_summary: 'x', scheduled_at: at
    });
    expect(res.status).toBe(201);
  }
}

beforeEach(async () => {
  await resetDb();
  sgMail.send.mockReset();
  sgMail.send.mockResolvedValue([{ statusCode: 202, headers: {} }]);
  workshop = await createWorkshop({ email: 'shop@test.local', ai_phone_number: '+15551112222' });
});

afterAll(() => pool.end());

describe('POST /api/voice/calls (a call is ringing)', () => {
  test('answers for a known shop with the agent setup, and records the call', async () => {
    const res = await start();
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('answer');

    const { rows } = await pool.query('SELECT * FROM calls WHERE id = $1', [res.body.call_id]);
    expect(rows[0]).toMatchObject({ workshop_id: workshop.id, provider_call_id: 'room-1', from_number: CALLER, status: 'initiated' });

    const agent = res.body.agent;
    expect(agent.greeting).toMatch(/AI assistant, and this call is recorded/); // US disclosure + recording consent
    expect(agent.timezone).toBe('America/New_York');
    expect(agent.instructions).toMatch(/Opening hours: Monday-Friday 8:00 AM-6:00 PM; Saturday 9:00 AM-2:00 PM; Sunday closed/);
    expect(agent.instructions).toMatch(/\(America\/New_York\)/);
    expect(agent.instructions).toContain(`calling from ${CALLER}`);
    expect(agent.tools.map((t) => t.name)).toEqual(['check_availability', 'book_appointment']);
  });

  test('matches the shop however the number is written', async () => {
    const res = await start({ to_number: '(555) 111-2222' });
    expect(res.body.action).toBe('answer');
  });

  test('a retried start for the same call returns the same call, not a second one', async () => {
    const first = await start();
    const second = await start();
    expect(second.body.call_id).toBe(first.body.call_id);
    expect((await pool.query('SELECT 1 FROM calls')).rowCount).toBe(1);
  });

  test('an unknown number is rejected without creating a call', async () => {
    const res = await start({ to_number: '+15550009999' });
    expect(res.body).toMatchObject({ action: 'reject' });
    expect((await pool.query('SELECT 1 FROM calls')).rowCount).toBe(0);
  });

  test('a suspended shop\'s calls are transferred to the shop, not dropped', async () => {
    await pool.query("UPDATE workshops SET status = 'suspended', transfer_phone = '+15557776666' WHERE id = $1", [workshop.id]);
    expect((await start()).body).toMatchObject({ action: 'transfer', transfer_to: '+15557776666' });
    await pool.query('UPDATE workshops SET transfer_phone = NULL WHERE id = $1', [workshop.id]);
    expect((await start()).body).toMatchObject({ action: 'transfer', transfer_to: workshop.phone });
  });

  test('the agent offers a transfer only when the shop has a transfer number', async () => {
    expect((await start()).body.agent.instructions).toMatch(/shop will call back/);
    await pool.query("UPDATE workshops SET transfer_phone = '+15557776666' WHERE id = $1", [workshop.id]);
    const res = await start({ provider_call_id: 'room-2' });
    expect(res.body.agent).toMatchObject({ transfer_phone: '+15557776666' });
    expect(res.body.agent.instructions).toMatch(/transfer the call/);
  });

  test('missing call id or number is a 400', async () => {
    expect((await voice.post('/api/voice/calls').send({ to_number: workshop.ai_phone_number })).status).toBe(400);
  });

  test('requires the voice agent key', async () => {
    const res = await request(app).post('/api/voice/calls').send({ provider_call_id: 'x', to_number: workshop.ai_phone_number });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/voice/calls/:callId/answered', () => {
  test('marks the call in progress with the time it was answered', async () => {
    const callId = await answeredCall();
    expect((await voice.post(`/api/voice/calls/${callId}/answered`)).status).toBe(200);
    const { rows } = await pool.query('SELECT status, answered_at FROM calls WHERE id = $1', [callId]);
    expect(rows[0]).toMatchObject({ status: 'in-progress', answered_at: expect.any(Date) });
  });

  test.each(['00000000-0000-0000-0000-000000000000', 'not-a-uuid'])('unknown call %p is a 404', async (id) => {
    expect((await voice.post(`/api/voice/calls/${id}/answered`)).status).toBe(404);
  });
});

describe('tool: check_availability', () => {
  const check = (callId, body) => voice.post(`/api/voice/calls/${callId}/availability`).send(body);

  test('the requested time, when free, comes first', async () => {
    const callId = await answeredCall();
    const res = await check(callId, { preferred_date: '2030-01-15', preferred_time: '2pm' });
    expect(res.body.requested_time_available).toBe(true);
    expect(res.body.slots[0]).toEqual({ start: '2030-01-15T19:00:00.000Z', spoken: 'Tuesday, January 15 at 2:00 PM' });
    expect(res.body.slots.length).toBeLessThanOrEqual(3);
  });

  test('a full requested time says so and offers the next free ones', async () => {
    await fillSlot();
    const callId = await answeredCall();
    const res = await check(callId, { preferred_date: '2030-01-15', preferred_time: '14:00' });
    expect(res.body.requested_time_available).toBe(false);
    expect(res.body.slots[0].spoken).toBe('Tuesday, January 15 at 3:00 PM');
  });

  test('a day without a time offers that day from opening', async () => {
    const callId = await answeredCall();
    const res = await check(callId, { preferred_date: '2030-01-15' });
    expect(res.body.slots[0].spoken).toBe('Tuesday, January 15 at 8:00 AM');
  });

  test('a date it cannot read is flagged so the agent asks again, with times offered anyway', async () => {
    const callId = await answeredCall();
    const res = await check(callId, { preferred_date: 'next Tuesday', preferred_time: 'afternoon' });
    expect(res.body.note).toMatch(/ask the caller again/);
    expect(res.body.slots.length).toBeGreaterThan(0);
  });
});

describe('tool: book_appointment', () => {
  test('books the chosen time and queues the confirmation emails', async () => {
    const callId = await answeredCall();
    const res = await book(callId);
    expect(res.body).toMatchObject({ booked: true, spoken: 'Tuesday, January 15 at 2:00 PM' });
    const { rows } = await pool.query('SELECT call_id, scheduled_at FROM bookings WHERE id = $1', [res.body.booking_id]);
    expect(rows[0]).toMatchObject({ call_id: callId });
    expect((await pool.query("SELECT 1 FROM notifications WHERE kind LIKE 'booking_%'")).rowCount).toBe(2);
  });

  test('a repeated booking request (agent retry) does not book twice', async () => {
    const callId = await answeredCall();
    const first = await book(callId);
    const second = await book(callId, { start: '2030-01-16T19:00:00.000Z' });
    expect(second.body).toMatchObject({ booked: true, booking_id: first.body.booking_id, note: expect.stringMatching(/already has this booking/) });
    expect((await pool.query('SELECT 1 FROM bookings')).rowCount).toBe(1);
  });

  test('a time taken a moment ago is refused with alternatives the agent can offer', async () => {
    await fillSlot();
    const callId = await answeredCall();
    const res = await book(callId);
    expect(res.status).toBe(200); // a "no" for the caller, not an error
    expect(res.body).toMatchObject({ booked: false, code: 'SLOT_FULL' });
    expect(res.body.alternatives.length).toBeGreaterThan(0);
  });

  test('missing details are listed so the agent can ask for them', async () => {
    const callId = await answeredCall();
    const res = await book(callId, { customer_name: '', issue_summary: '' });
    expect(res.body).toMatchObject({ booked: false, code: 'INVALID_INPUT' });
    expect(res.body.missing.join(' ')).toMatch(/customer_name.*issue_summary/);
  });

  test('without a phone number, the number they called from is used', async () => {
    const callId = await answeredCall();
    const res = await book(callId);
    const { rows } = await pool.query(
      'SELECT c.phone FROM bookings b JOIN customers c ON c.id = b.customer_id WHERE b.id = $1',
      [res.body.booking_id]
    );
    expect(rows[0].phone).toBe(CALLER);
  });
});

describe('POST /api/voice/calls/:callId/end (end-of-call report)', () => {
  const end = (callId, body) => voice.post(`/api/voice/calls/${callId}/end`).send(body);
  const report = (outcome = {}) => ({
    ended_reason: 'customer-ended-call',
    started_at: '2030-01-10T15:00:00Z',
    ended_at: '2030-01-10T15:03:20Z',
    transcript: 'AI: Hello...',
    recording_url: 'https://example.com/rec.wav',
    cost_usd: 0.12,
    summary: 'Caller wanted brake work',
    outcome: { customer_name: 'Jane Doe', customer_phone: '555-999-8888', issue_summary: 'Brakes grinding', ...outcome }
  });

  test('saves the call details; the duration is worked out from start and end', async () => {
    const callId = await answeredCall();
    expect((await end(callId, report())).body).toMatchObject({ ok: true, duplicate: false });
    const { rows } = await pool.query('SELECT * FROM calls WHERE id = $1', [callId]);
    expect(rows[0]).toMatchObject({ status: 'completed', duration_seconds: 200, ended_reason: 'customer-ended-call', recording_url: 'https://example.com/rec.wav' });
    const analysis = (await pool.query('SELECT * FROM call_analysis WHERE call_id = $1', [callId])).rows[0];
    expect(analysis).toMatchObject({ customer_phone: '+15559998888', booking_created: false, callback_requested: false });
  });

  test('a booked call is marked as such and needs no call back', async () => {
    const callId = await answeredCall();
    await book(callId);
    await end(callId, report({ booking_requested: true }));
    const analysis = (await pool.query('SELECT * FROM call_analysis WHERE call_id = $1', [callId])).rows[0];
    expect(analysis).toMatchObject({ booking_created: true, callback_requested: false });
  });

  test('a caller who wanted a booking but did not get one triggers a call-back alert to the shop', async () => {
    await pool.query("UPDATE workshops SET notify_emails = ARRAY['owner@test.local'] WHERE id = $1", [workshop.id]);
    const callId = await answeredCall();
    await end(callId, report({ booking_requested: true }));

    const analysis = (await pool.query('SELECT * FROM call_analysis WHERE call_id = $1', [callId])).rows[0];
    expect(analysis.callback_requested).toBe(true);

    await sendDueNotifications({ logger: quiet });
    const sent = sgMail.send.mock.calls.map(([m]) => m);
    expect(sent.map((m) => m.to).sort()).toEqual(['owner@test.local', 'shop@test.local']);
    expect(sent[0].subject).toBe('Call back needed: Jane Doe (+15559998888)');
    expect(sent[0].text).toContain('Brakes grinding');
  });

  test('a repeated report is ignored: no second alert', async () => {
    const callId = await answeredCall();
    await end(callId, report({ booking_requested: true }));
    expect((await end(callId, report({ booking_requested: true }))).body).toMatchObject({ duplicate: true });
    expect((await pool.query("SELECT 1 FROM notifications WHERE kind = 'callback_requested'")).rowCount).toBe(1);
  });

  test('a report that fails to process is kept with its error, not lost', async () => {
    const callId = await answeredCall();
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    // The call disappears before the report is processed: saving the analysis then fails
    await pool.query(
      `INSERT INTO webhook_events (provider, event_type, dedupe_key, payload)
       VALUES ('voice-agent', 'call-ended', 'call-ended:gone', $1)`,
      [JSON.stringify({ call_id: '00000000-0000-0000-0000-000000000000', report: report() })]
    );
    expect(await retryCallReports({ olderThanSeconds: 0 })).toBe(1);
    const stored = (await pool.query("SELECT status, attempts, last_error FROM webhook_events WHERE dedupe_key = 'call-ended:gone'")).rows[0];
    expect(stored).toMatchObject({ status: 'failed', attempts: 1, last_error: expect.stringMatching(/foreign key/) });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    expect(callId).toBeTruthy();
  });

  test('the worker processes a stored report that was never processed (e.g. server restarted)', async () => {
    const callId = await answeredCall();
    await pool.query(
      `INSERT INTO webhook_events (provider, event_type, dedupe_key, payload)
       VALUES ('voice-agent', 'call-ended', $1, $2)`,
      [`call-ended:${callId}`, JSON.stringify({ call_id: callId, report: report({ booking_requested: true }) })]
    );
    expect(await retryCallReports({ olderThanSeconds: 0 })).toBe(1);
    expect((await pool.query('SELECT status FROM webhook_events')).rows[0].status).toBe('processed');
    expect((await pool.query('SELECT status FROM calls WHERE id = $1', [callId])).rows[0].status).toBe('completed');
    expect((await pool.query("SELECT 1 FROM notifications WHERE kind = 'callback_requested'")).rowCount).toBe(1);
    expect(await retryCallReports({ olderThanSeconds: 0 })).toBe(0); // done; not processed twice
  });

  test('a report for an unknown call is a 404 and stores nothing', async () => {
    const res = await end('00000000-0000-0000-0000-000000000000', report());
    expect(res.status).toBe(404);
    expect((await pool.query('SELECT 1 FROM webhook_events')).rowCount).toBe(0);
  });
});

describe('tool definitions match the API', () => {
  test('every tool given to the agent has a working endpoint', async () => {
    const callId = await answeredCall();
    for (const tool of TOOLS) {
      const res = await voice.post(`/api/voice/calls/${callId}/${tool.endpoint}`).send({});
      expect({ tool: tool.name, status: res.status }).toEqual({ tool: tool.name, status: 200 });
    }
  });

  test('book_appointment\'s parameters are exactly what the booking endpoint reads', () => {
    const tool = TOOLS.find((t) => t.name === 'book_appointment');
    expect(Object.keys(tool.parameters.properties).sort()).toEqual([
      'customer_email', 'customer_name', 'customer_phone', 'issue_category', 'issue_summary',
      'start', 'urgency', 'vehicle_make', 'vehicle_model', 'vehicle_year'
    ]);
  });
});
