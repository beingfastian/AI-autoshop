// The notifications outbox against the real database: queueing, sending, retries, reminders, SMS.
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: jest.fn() }));

const request = require('supertest');
const sgMail = require('@sendgrid/mail');
const app = require('../src/app');
const { createBooking } = require('../src/services/bookings');
const { sendDueNotifications, sweepReminders, MAX_ATTEMPTS } = require('../src/services/notifications');
const { pool, resetDb, createWorkshop } = require('./helpers');

const APPOINTMENT = new Date('2030-01-15T09:00:00Z'); // Tuesday 2:00 PM in Karachi
const hoursBefore = (h) => new Date(APPOINTMENT.getTime() - h * 3600 * 1000);
const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
const send = (options = {}) => sendDueNotifications({ logger, ...options });
const accepted = (id = 'msg-1') => [{ statusCode: 202, headers: { 'x-message-id': id } }];
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { code: status });

let workshop;

async function book({ email = 'Jane@Example.com', at = APPOINTMENT, rollback = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { booking } = await createBooking(client, {
      workshopId: workshop.id,
      customer: { name: 'Jane', phone: '+923001234567', email },
      vehicle: { make: 'Toyota', model: 'Corolla' },
      issue: { summary: 'Brake noise' },
      scheduledAt: at
    });
    await client.query(rollback ? 'ROLLBACK' : 'COMMIT');
    return booking;
  } finally {
    client.release();
  }
}

const rows = async () =>
  (await pool.query('SELECT channel, kind, recipient, status, attempts, last_error FROM notifications ORDER BY kind, recipient')).rows;

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
  sgMail.send.mockReset(); // also drops queued mockRejectedValueOnce values from earlier tests
  sgMail.send.mockResolvedValue(accepted());
  workshop = await createWorkshop({ email: 'shop@test.local' });
});

afterAll(() => pool.end());

describe('queueing', () => {
  test('a booking queues the customer confirmation and one alert per shop address', async () => {
    await pool.query("UPDATE workshops SET notify_emails = ARRAY['owner@test.local', 'SHOP@test.local'] WHERE id = $1", [workshop.id]);
    await book();
    expect((await rows()).map((r) => [r.channel, r.kind, r.recipient, r.status])).toEqual([
      ['email', 'booking_confirmation_customer', 'jane@example.com', 'pending'],
      ['email', 'booking_notification_workshop', 'owner@test.local', 'pending'],
      ['email', 'booking_notification_workshop', 'shop@test.local', 'pending'] // duplicate address collapsed
    ]);
  });

  test('a customer without an email still gets the shop alert', async () => {
    await book({ email: null });
    expect((await rows()).map((r) => r.kind)).toEqual(['booking_notification_workshop']);
  });

  test('a booking that rolls back queues and sends nothing', async () => {
    await book({ rollback: true });
    await send();
    expect(await rows()).toEqual([]);
    expect(sgMail.send).not.toHaveBeenCalled();
  });
});

describe('sending', () => {
  test('due messages are sent once and recorded with the provider id', async () => {
    await book();
    expect(await send()).toMatchObject({ sent: 2 });
    expect(await send()).toMatchObject({ sent: 0 });
    expect(sgMail.send).toHaveBeenCalledTimes(2);
    const { rows: sent } = await pool.query('SELECT status, attempts, sent_at, provider_message_id FROM notifications');
    for (const row of sent) expect(row).toMatchObject({ status: 'sent', attempts: 1, provider_message_id: 'msg-1', sent_at: expect.any(Date) });
  });

  test('a temporary failure is retried after a backoff, then succeeds', async () => {
    await book({ email: null }); // one message: the shop alert
    const now = new Date(Date.now() + 1000); // just after the rows were queued
    sgMail.send.mockRejectedValueOnce(httpError(503));

    expect(await send({ now })).toMatchObject({ retrying: 1 });
    expect((await rows())[0]).toMatchObject({ status: 'pending', attempts: 1, last_error: 'HTTP 503' });

    expect(await send({ now: new Date(now.getTime() + 30 * 1000) })).toMatchObject({ sent: 0 }); // not yet
    expect(await send({ now: new Date(now.getTime() + 61 * 1000) })).toMatchObject({ sent: 1 }); // after 1 minute
    expect((await rows())[0]).toMatchObject({ status: 'sent', attempts: 2, last_error: null });
  });

  test(`after ${MAX_ATTEMPTS} failed attempts the message is marked failed and logged`, async () => {
    await book({ email: null });
    sgMail.send.mockRejectedValue(httpError(500));
    let now = new Date(Date.now() + 1000);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await send({ now });
      now = new Date(now.getTime() + 61 * 60 * 1000); // past the longest backoff
    }
    expect((await rows())[0]).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/Giving up on email booking_notification_workshop/));
    await send({ now });
    expect(sgMail.send).toHaveBeenCalledTimes(MAX_ATTEMPTS); // never tried again
  });

  test('a permanent error (e.g. invalid address) fails at once instead of retrying', async () => {
    await book({ email: null });
    sgMail.send.mockRejectedValueOnce(httpError(400));
    expect(await send()).toMatchObject({ failed: 1 });
    expect((await rows())[0]).toMatchObject({ status: 'failed', attempts: 1 });
  });

  test('a rate limit (429) is retried, not treated as permanent', async () => {
    await book({ email: null });
    sgMail.send.mockRejectedValueOnce(httpError(429));
    expect(await send()).toMatchObject({ retrying: 1 });
  });

  test('messages for a booking cancelled before sending are skipped', async () => {
    const booking = await book();
    await pool.query("UPDATE bookings SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1", [booking.id]);
    expect(await send()).toMatchObject({ sent: 0, skipped: 2 });
    expect(sgMail.send).not.toHaveBeenCalled();
    expect((await rows()).every((r) => r.status === 'skipped' && r.last_error === 'booking is cancelled')).toBe(true);
  });

  test('two workers running at the same time never send the same message twice', async () => {
    for (let i = 0; i < 4; i++) {
      await book({ email: `c${i}@test.local`, at: new Date(APPOINTMENT.getTime() + i * 3600 * 1000) });
    }
    sgMail.send.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20)); // slow provider, so the workers overlap
      return accepted();
    });
    const results = await Promise.all([send(), send(), send()]);
    const total = results.reduce((n, r) => n + r.sent, 0);
    expect(total).toBe(8); // 4 customers + 4 shop alerts
    expect(sgMail.send).toHaveBeenCalledTimes(8);
  });
});

describe('reminders', () => {
  const reminderRows = async () =>
    (await pool.query("SELECT kind, status FROM notifications WHERE kind LIKE 'reminder_%' ORDER BY kind")).rows;

  test('24h and 2h reminders are each queued and sent exactly once', async () => {
    await book();
    await send(); // confirmations

    expect(await sweepReminders({ now: hoursBefore(23) })).toBe(1);
    expect(await sweepReminders({ now: hoursBefore(22) })).toBe(0); // repeated sweeps add nothing
    await send({ now: hoursBefore(23) });
    expect(sgMail.send.mock.calls.at(-1)[0].subject).toMatch(/tomorrow/);

    expect(await sweepReminders({ now: hoursBefore(1.5) })).toBe(1);
    expect(await sweepReminders({ now: hoursBefore(1) })).toBe(0);
    await send({ now: hoursBefore(1.5) });
    expect(sgMail.send.mock.calls.at(-1)[0].subject).toMatch(/in 2 hours/);

    expect(await reminderRows()).toEqual([
      { kind: 'reminder_24h', status: 'sent' },
      { kind: 'reminder_2h', status: 'sent' }
    ]);
    expect(sgMail.send).toHaveBeenCalledTimes(4); // 2 confirmations + 2 reminders
  });

  test('a worker that was down catches up with the 2h reminder only, not a stale 24h one', async () => {
    await book();
    expect(await sweepReminders({ now: hoursBefore(1) })).toBe(1);
    expect(await reminderRows()).toEqual([{ kind: 'reminder_2h', status: 'pending' }]);
  });

  test('a booking made less than 24h ahead gets no 24h reminder (it just got its confirmation)', async () => {
    const booking = await book();
    await pool.query('UPDATE bookings SET created_at = $2 WHERE id = $1', [booking.id, hoursBefore(20)]);
    expect(await sweepReminders({ now: hoursBefore(19) })).toBe(0);
    expect(await sweepReminders({ now: hoursBefore(1) })).toBe(1); // the 2h one still comes
  });

  test('cancelled bookings get no reminders', async () => {
    const booking = await book();
    await pool.query("UPDATE bookings SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1", [booking.id]);
    expect(await sweepReminders({ now: hoursBefore(23) })).toBe(0);
  });

  test('a reminder whose appointment has already started is skipped, not sent late', async () => {
    await book();
    await send();
    await sweepReminders({ now: hoursBefore(1) });
    expect(await send({ now: new Date(APPOINTMENT.getTime() + 60 * 1000) })).toMatchObject({ skipped: 1, sent: 0 });
  });

  test('moving a booking resets its reminders for the new time', async () => {
    const booking = await book();
    await send();
    await sweepReminders({ now: hoursBefore(23) });
    await send({ now: hoursBefore(23) });

    const res = await request(app)
      .put(`/api/bookings/${booking.id}`)
      .set('x-api-key', process.env.API_KEY)
      .send({ scheduled_at: '2030-01-17T09:00:00Z' }); // Thursday 2 PM
    expect(res.status).toBe(200);
    expect(await reminderRows()).toEqual([]);

    const newDayBefore = new Date('2030-01-16T10:00:00Z');
    expect(await sweepReminders({ now: newDayBefore })).toBe(1);
  });
});

describe('SMS (ENABLE_SMS)', () => {
  const smsEnv = {
    ENABLE_SMS: 'true',
    TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
    TWILIO_AUTH_TOKEN: 'test-auth-token-123456',
    TWILIO_PHONE_NUMBER: '+15550001234'
  };
  let saved;
  let fetchSpy;

  beforeEach(() => {
    saved = Object.fromEntries(Object.keys(smsEnv).map((k) => [k, process.env[k]]));
    fetchSpy = jest.spyOn(global, 'fetch');
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fetchSpy.mockRestore();
  });

  test('is off by default: no SMS is queued', async () => {
    await book();
    expect((await rows()).some((r) => r.channel === 'sms')).toBe(false);
  });

  test('when enabled, texts the customer and the shop\'s SMS numbers through Twilio', async () => {
    Object.assign(process.env, smsEnv);
    await pool.query("UPDATE workshops SET notify_sms = ARRAY['+923009998888'] WHERE id = $1", [workshop.id]);
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 }));

    await book();
    await send();

    const sms = fetchSpy.mock.calls.map(([url, init]) => ({ url, params: Object.fromEntries(init.body) }));
    expect(sms).toHaveLength(2);
    expect(sms[0].url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${smsEnv.TWILIO_ACCOUNT_SID}/Messages.json`);
    expect(sms.map((s) => s.params.To).sort()).toEqual(['+923001234567', '+923009998888']);
    expect(sms.every((s) => s.params.From === '+15550001234')).toBe(true);
    const customerText = sms.find((s) => s.params.To === '+923001234567').params.Body;
    expect(customerText).toMatch(/confirmed for Tuesday, January 15, 2030 at 2:00 PM/);
  });

  test('a Twilio rejection (e.g. invalid number) fails at once', async () => {
    Object.assign(process.env, smsEnv);
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ message: 'Invalid To number' }), { status: 400 }));
    await book({ email: null });
    await send();
    const sms = (await rows()).find((r) => r.channel === 'sms');
    expect(sms).toMatchObject({ status: 'failed', attempts: 1, last_error: 'Twilio 400: Invalid To number' });
  });
});

describe('health', () => {
  test('reports messages the worker should have sent by now', async () => {
    await book();
    await pool.query("UPDATE notifications SET send_after = NOW() - interval '10 minutes'");
    const res = await request(app).get('/health');
    expect(res.body.notifications_overdue).toBe(2);
  });
});
