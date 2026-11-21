// The worker schedules jobs; node-cron is mocked so nothing actually runs on a timer
jest.mock('node-cron', () => ({ schedule: jest.fn(() => ({ stop: jest.fn() })) }));
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: jest.fn() }));

const cron = require('node-cron');
const { startWorker, REMINDER_SCHEDULE } = require('../src/worker');
const { pool } = require('./helpers');

afterAll(() => pool.end());

test('schedules the reminder job every hour', () => {
  const tasks = startWorker();
  expect(REMINDER_SCHEDULE).toBe('0 * * * *');
  expect(cron.schedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function));
  expect(tasks).toHaveLength(1);
});

test('a failing reminder run is logged, not thrown', async () => {
  startWorker();
  const job = cron.schedule.mock.calls.at(-1)[1];
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await expect(job()).resolves.toBeUndefined();
  expect(error).toHaveBeenCalledWith('Reminder job failed:', expect.anything());
});

test('importing the app does not start the scheduler', () => {
  cron.schedule.mockClear();
  jest.isolateModules(() => require('../src/app'));
  expect(cron.schedule).not.toHaveBeenCalled();
});
