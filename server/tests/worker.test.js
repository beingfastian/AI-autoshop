// The worker's loops. The outbox functions are mocked here; their real behavior is tested
// against the database in notifications.test.js.
jest.mock('../src/services/notifications', () => ({
  sendDueNotifications: jest.fn(),
  sweepReminders: jest.fn()
}));

const { sendDueNotifications, sweepReminders } = require('../src/services/notifications');
const { startWorker, SEND_INTERVAL_MS, REMINDER_INTERVAL_MS } = require('../src/worker');
const { pool } = require('./helpers');

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  jest.clearAllMocks();
  sendDueNotifications.mockResolvedValue({ sent: 0, retrying: 0, failed: 0, skipped: 0 });
  sweepReminders.mockResolvedValue(0);
});

afterAll(() => pool.end());

test('sends every 5 seconds and sweeps reminders every 15 minutes by default', () => {
  expect(SEND_INTERVAL_MS).toBe(5000);
  expect(REMINDER_INTERVAL_MS).toBe(15 * 60 * 1000);
});

test('runs both jobs straight away and then keeps repeating them', async () => {
  const worker = startWorker({ logger, sendIntervalMs: 20, reminderIntervalMs: 20 });
  await sleep(120);
  await worker.stop();
  expect(sendDueNotifications.mock.calls.length).toBeGreaterThanOrEqual(3);
  expect(sweepReminders.mock.calls.length).toBeGreaterThanOrEqual(3);
});

test('a failing run is logged and the loop keeps going', async () => {
  sendDueNotifications.mockRejectedValueOnce(new Error('database restarting'));
  const worker = startWorker({ logger, sendIntervalMs: 20, reminderIntervalMs: 10000 });
  await sleep(100);
  await worker.stop();
  expect(logger.error).toHaveBeenCalledWith('❌ Notification sender failed:', expect.any(Error));
  expect(sendDueNotifications.mock.calls.length).toBeGreaterThanOrEqual(2);
});

test('runs never overlap, and stop() waits for the one in progress', async () => {
  let active = 0;
  let maxActive = 0;
  let finished = 0;
  sendDueNotifications.mockImplementation(async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await sleep(60);
    active--;
    finished++;
    return { sent: 0, retrying: 0, failed: 0, skipped: 0 };
  });
  const worker = startWorker({ logger, sendIntervalMs: 1, reminderIntervalMs: 10000 });
  await sleep(30); // first run is mid-flight
  await worker.stop();
  expect(maxActive).toBe(1);
  expect(active).toBe(0); // nothing left running after stop()
  const after = finished;
  await sleep(100);
  expect(finished).toBe(after); // and nothing starts after stop()
});

test('importing the API app does not start the worker loops', () => {
  jest.isolateModules(() => require('../src/app'));
  expect(sendDueNotifications).not.toHaveBeenCalled();
  expect(sweepReminders).not.toHaveBeenCalled();
});
