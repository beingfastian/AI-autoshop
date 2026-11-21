// Staff read routes for call history. Live calls are tested in voice.test.js.
jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn().mockResolvedValue([{ statusCode: 202 }])
}));

const request = require('supertest');
const app = require('../src/app');
const api = request.agent(app).set('x-api-key', process.env.API_KEY); // /api routes need the key
const { pool, resetDb, createWorkshop } = require('./helpers');

let workshop;
let callId;

beforeEach(async () => {
  await resetDb();
  workshop = await createWorkshop();
  const { rows } = await pool.query(
    `INSERT INTO calls (workshop_id, from_number, to_number, provider_call_id)
     VALUES ($1, '+15559998888', $2, 'CA-1') RETURNING id`,
    [workshop.id, workshop.ai_phone_number]
  );
  callId = rows[0].id;
});

afterAll(() => pool.end());

describe('GET /api/calls', () => {
  test('GET /:id returns the call with its workshop name', async () => {
    const res = await api.get(`/api/calls/${callId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: callId, workshop_name: workshop.name });
  });

  test('GET /:id returns 404 for an unknown call', async () => {
    const res = await api.get('/api/calls/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  test('GET /:id returns 404 for a malformed id instead of a 500', async () => {
    const res = await api.get('/api/calls/not-a-uuid');
    expect(res.status).toBe(404);
  });

  test('GET /workshop/:workshopId lists calls with a total', async () => {
    const res = await api.get(`/api/calls/workshop/${workshop.id}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.calls[0].id).toBe(callId);
  });

  test('the old simulated /inbound route is gone', async () => {
    const res = await api.post('/api/calls/inbound').send({ to: workshop.ai_phone_number });
    expect(res.status).toBe(404);
  });
});
