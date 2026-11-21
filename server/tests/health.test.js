// SendGrid is mocked: tests must never send real email
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: jest.fn() }));

const request = require('supertest');
const app = require('../src/app');
const { pool } = require('./helpers');

afterAll(() => pool.end());

test('GET /health reports healthy when the database is reachable', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ status: 'healthy', service: 'ai-receptionist' });
});

test('unknown routes return 404', async () => {
  const res = await request(app).get('/nope');
  expect(res.status).toBe(404);
});

test('one app serves both the call and the booking routes', async () => {
  const calls = await request(app).get('/api/calls/workshop/00000000-0000-0000-0000-000000000000');
  const bookings = await request(app).get('/api/bookings');
  expect(calls.status).not.toBe(404);
  expect(bookings.status).not.toBe(404);
});

test('rate limiting covers call routes but not booking routes, as before the merge', async () => {
  const calls = await request(app).get('/api/calls/workshop/00000000-0000-0000-0000-000000000000');
  const bookings = await request(app).get('/api/bookings');
  expect(calls.headers).toHaveProperty('ratelimit-limit');
  expect(bookings.headers).not.toHaveProperty('ratelimit-limit');
});
