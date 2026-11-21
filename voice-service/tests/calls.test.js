const request = require('supertest');
const app = require('../src/index');
const { pool, resetDb, createWorkshop } = require('./helpers');

let workshop;

beforeEach(async () => {
  await resetDb();
  workshop = await createWorkshop();
});

afterAll(() => pool.end());

const inbound = (body) => request(app).post('/api/calls/inbound').send(body);

describe('POST /api/calls/inbound', () => {
  test('returns 404 when no active workshop owns the number', async () => {
    const res = await inbound({ from: '+15559998888', to: '+15550009999', callSid: 'CA-unknown' });
    expect(res.status).toBe(404);
  });

  test('creates an initiated call record for a known workshop number', async () => {
    const res = await inbound({ from: '+15559998888', to: workshop.vapi_phone_number, callSid: 'CA-1' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, workshop_name: workshop.name, status: 'initiated' });

    const { rows } = await pool.query('SELECT * FROM calls WHERE id = $1', [res.body.call_id]);
    expect(rows[0]).toMatchObject({
      workshop_id: workshop.id,
      from_number: '+15559998888',
      vapi_call_id: 'CA-1',
      status: 'initiated'
    });
  });

  test('ignores suspended workshops', async () => {
    await pool.query(`UPDATE workshops SET status = 'suspended' WHERE id = $1`, [workshop.id]);
    const res = await inbound({ from: '+15559998888', to: workshop.vapi_phone_number, callSid: 'CA-2' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/calls', () => {
  let callId;

  beforeEach(async () => {
    const res = await inbound({ from: '+15559998888', to: workshop.vapi_phone_number, callSid: 'CA-3' });
    callId = res.body.call_id;
  });

  test('GET /:id returns the call with its workshop name', async () => {
    const res = await request(app).get(`/api/calls/${callId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: callId, workshop_name: workshop.name });
  });

  test('GET /:id returns 404 for an unknown call', async () => {
    const res = await request(app).get('/api/calls/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  test('GET /workshop/:workshopId lists calls with a total', async () => {
    const res = await request(app).get(`/api/calls/workshop/${workshop.id}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.calls[0].id).toBe(callId);
  });
});
