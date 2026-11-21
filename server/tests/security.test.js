// Step 1.3: startup config check, interim API key, no error leaks, DB errors don't kill the process
jest.mock('@sendgrid/mail', () => ({ setApiKey: jest.fn(), send: jest.fn() }));

const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');
const app = require('../src/app');
const { validateEnv } = require('../src/config/env');
const { safeHtml } = require('../src/utils/safeHtml');
const { pool, resetDb, createWorkshop } = require('./helpers');

afterAll(() => pool.end());

const VALID_ENV = {
  API_KEY: 'k'.repeat(32),
  VOICE_AGENT_KEY: 'v'.repeat(32),
  SENDGRID_API_KEY: 'SG.abc',
  SENDGRID_FROM_EMAIL: 'noreply@example.com'
};

describe('environment validation', () => {
  test('accepts a complete configuration', () => {
    expect(() => validateEnv(VALID_ENV)).not.toThrow();
  });

  test('lists every missing variable in one clear error', () => {
    expect(() => validateEnv({})).toThrow(
      /API_KEY is missing[\s\S]*VOICE_AGENT_KEY is missing[\s\S]*SENDGRID_API_KEY is missing/
    );
  });

  test('treats empty values copied from .env.example as missing', () => {
    expect(() => validateEnv({ ...VALID_ENV, API_KEY: '' })).toThrow(/API_KEY is missing/);
  });

  test('explains invalid values', () => {
    let message;
    try {
      validateEnv({ ...VALID_ENV, API_KEY: 'short', SENDGRID_API_KEY: 'abc', PORT: 'x' });
    } catch (e) {
      message = e.message;
    }
    expect(message).toMatch(/API_KEY must be at least 32 characters/);
    expect(message).toMatch(/SENDGRID_API_KEY must start with "SG\."/);
    expect(message).toMatch(/PORT must be a whole number/);
  });

  test('the API process refuses to start without required variables', () => {
    // run from an empty folder so no .env file is picked up
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
      cwd: os.tmpdir(),
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      encoding: 'utf8',
      timeout: 20000
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid environment configuration[\s\S]*API_KEY is missing/);
  });
});

describe('API key on /api routes', () => {
  test.each(['/api/calls/workshop/00000000-0000-0000-0000-000000000000', '/api/bookings'])(
    '%s returns 401 without the key',
    async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
    }
  );

  test('returns 401 with a wrong key', async () => {
    const res = await request(app).get('/api/bookings').set('x-api-key', 'wrong');
    expect(res.status).toBe(401);
  });

  test('lets requests with the right key through', async () => {
    const res = await request(app).get('/api/bookings').set('x-api-key', process.env.API_KEY);
    expect(res.status).toBe(200);
  });

  test('the voice agent uses its own key: the staff key does not open /api/voice, and vice versa', async () => {
    const start = { provider_call_id: 'x', to_number: '+15550009999' };
    const voiceAuth = `Bearer ${process.env.VOICE_AGENT_KEY}`;
    const withVoiceKey = await request(app).post('/api/voice/calls').set('Authorization', voiceAuth).send(start);
    const withStaffKey = await request(app).post('/api/voice/calls').set('Authorization', `Bearer ${process.env.API_KEY}`).send(start);
    const staffRouteWithVoiceKey = await request(app).get('/api/bookings').set('x-api-key', process.env.VOICE_AGENT_KEY);
    expect(withVoiceKey.status).toBe(200);
    expect(withStaffKey.status).toBe(401);
    expect(staffRouteWithVoiceKey.status).toBe(401);
  });

  test('/health stays public', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});

describe('error responses do not leak internals', () => {
  test('a failing voice request does not return the database error text', async () => {
    await resetDb();
    const workshop = await createWorkshop();
    const { rows } = await pool.query(
      `INSERT INTO calls (workshop_id, from_number, to_number, provider_call_id) VALUES ($1, '+15559998888', $2, 'CA-1') RETURNING id`,
      [workshop.id, workshop.ai_phone_number]
    );
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const dbFailure = jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('relation "calls" is locked by user admin'));

    const res = await request(app)
      .post(`/api/voice/calls/${rows[0].id}/answered`)
      .set('Authorization', `Bearer ${process.env.VOICE_AGENT_KEY}`);

    expect(error).toHaveBeenCalled(); // the real error is logged...
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/locked|relation/); // ...but not sent back
    dbFailure.mockRestore();
    error.mockRestore();
  });

  test('an unhealthy database is reported without the error text', async () => {
    const spy = jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('password authentication failed for user "x"'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(/password/);
    spy.mockRestore();
    error.mockRestore();
  });

  test('malformed JSON still gets a useful 400', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .post('/api/bookings')
      .set('x-api-key', process.env.API_KEY)
      .set('Content-Type', 'application/json')
      .send('{"bad json');
    expect(res.status).toBe(400);
    error.mockRestore();
  });
});

describe('database connection errors', () => {
  test('an idle-client error is logged and does not exit the process', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    pool.emit('error', new Error('terminating connection due to administrator command'));
    expect(exit).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    exit.mockRestore();
    error.mockRestore();
  });
});

describe('safeHtml', () => {
  test('escapes interpolated values but not nested safeHtml blocks', () => {
    const name = '<b>"Tom" & \'Jerry\'</b>';
    const inner = safeHtml`<i>${name}</i>`;
    expect(String(safeHtml`<p>${name}</p>${inner}${undefined}`)).toBe(
      '<p>&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;</p><i>&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;</i>'
    );
  });
});

describe('SMS configuration', () => {
  test('SMS settings are optional while SMS is off', () => {
    expect(() => validateEnv({ ...VALID_ENV, ENABLE_SMS: 'false' })).not.toThrow();
  });

  test('turning SMS on without Twilio settings fails at startup with a clear message', () => {
    expect(() => validateEnv({ ...VALID_ENV, ENABLE_SMS: 'true' })).toThrow(
      /TWILIO_ACCOUNT_SID is required when ENABLE_SMS=true[\s\S]*TWILIO_AUTH_TOKEN is required when ENABLE_SMS=true[\s\S]*TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID is required/
    );
  });

  test('a messaging service can be used instead of a phone number', () => {
    expect(() => validateEnv({
      ...VALID_ENV,
      ENABLE_SMS: 'true',
      TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
      TWILIO_AUTH_TOKEN: 'test-auth-token-123456',
      TWILIO_MESSAGING_SERVICE_SID: 'MG00000000000000000000000000000000'
    })).not.toThrow();
  });

  test('a phone number must be in international format', () => {
    expect(() => validateEnv({ ...VALID_ENV, TWILIO_PHONE_NUMBER: '0300 1234567' })).toThrow(/TWILIO_PHONE_NUMBER must be in international format/);
  });
});
