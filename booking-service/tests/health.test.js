// SendGrid is mocked: tests must never send real email
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: jest.fn() }));

const request = require('supertest');
const app = require('../src/index');
const { pool } = require('./helpers');

afterAll(() => pool.end());

test('GET /health reports healthy when the database is reachable', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ status: 'healthy', service: 'booking-service' });
});
