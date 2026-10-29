// db-config reads env at require time, so each test sets env first and loads a fresh copy.
// dotenv is mocked so real .env files on the machine can't leak into these tests.
jest.mock('dotenv', () => ({ config: jest.fn() }));

const DB_VARS = ['DATABASE_URL', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL', 'TEST_DB_NAME'];
const savedEnv = {};

beforeEach(() => {
  for (const key of DB_VARS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of DB_VARS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function loadConfig(env) {
  Object.assign(process.env, env);
  let mod;
  jest.isolateModules(() => {
    mod = require('../db-config');
  });
  return mod;
}

describe('connectionConfig with only DATABASE_URL set', () => {
  const DATABASE_URL = 'postgres://app:s3cret@db.example.com:6543/ai_receptionist?sslmode=require';

  test('uses the URL as-is for the default database', () => {
    const { connectionConfig } = loadConfig({ DATABASE_URL });
    expect(connectionConfig()).toEqual({ connectionString: DATABASE_URL });
  });

  test('swaps in a different database but keeps credentials, host and options', () => {
    const { connectionConfig } = loadConfig({ DATABASE_URL });
    expect(connectionConfig('ai_receptionist_test')).toEqual({
      connectionString: 'postgres://app:s3cret@db.example.com:6543/ai_receptionist_test?sslmode=require'
    });
  });

  test('takes precedence over DB_* variables', () => {
    const { connectionConfig } = loadConfig({ DATABASE_URL, DB_HOST: 'other-host', DB_USER: 'other' });
    expect(connectionConfig('x_test').connectionString).toContain('app:s3cret@db.example.com:6543/x_test');
  });
});

describe('connectionConfig with DB_* variables', () => {
  const vars = { DB_HOST: 'localhost', DB_PORT: '5433', DB_NAME: 'dev_db', DB_USER: 'postgres', DB_PASSWORD: 'pw' };

  test('builds a config for the default database', () => {
    const { connectionConfig } = loadConfig(vars);
    expect(connectionConfig()).toEqual({
      host: 'localhost', port: 5433, database: 'dev_db', user: 'postgres', password: 'pw', ssl: false
    });
  });

  test('overrides only the database name when one is given', () => {
    const { connectionConfig } = loadConfig(vars);
    expect(connectionConfig('ai_receptionist_test')).toMatchObject({ host: 'localhost', database: 'ai_receptionist_test' });
  });
});

describe('testDbEnv', () => {
  test('derives DB_* for the services from DATABASE_URL, decoding credentials', () => {
    const { testDbEnv } = loadConfig({ DATABASE_URL: 'postgres://app%40corp:p%40ss%3Aword@db.example.com:6543/main?sslmode=require' });
    expect(testDbEnv()).toEqual({
      DB_HOST: 'db.example.com',
      DB_PORT: '6543',
      DB_USER: 'app@corp',
      DB_PASSWORD: 'p@ss:word',
      DB_SSL: 'true',
      DB_NAME: 'ai_receptionist_test'
    });
  });

  test('defaults the port, strips IPv6 brackets and treats sslmode=disable as no SSL', () => {
    const { testDbEnv } = loadConfig({ DATABASE_URL: 'postgres://u:p@[::1]/main?sslmode=disable' });
    expect(testDbEnv()).toMatchObject({ DB_HOST: '::1', DB_PORT: '5432', DB_SSL: 'false' });
  });

  test('omits credentials the URL does not contain', () => {
    const { testDbEnv } = loadConfig({ DATABASE_URL: 'postgres://localhost/main' });
    const env = testDbEnv();
    expect(env).not.toHaveProperty('DB_USER');
    expect(env).not.toHaveProperty('DB_PASSWORD');
  });

  test('passes DB_* settings through, pointing at the test database', () => {
    const { testDbEnv } = loadConfig({ DB_HOST: 'localhost', DB_PORT: '5432', DB_USER: 'postgres', DB_PASSWORD: 'pw', DB_NAME: 'dev_db' });
    expect(testDbEnv()).toEqual({
      DB_HOST: 'localhost', DB_PORT: '5432', DB_USER: 'postgres', DB_PASSWORD: 'pw', DB_SSL: 'false', DB_NAME: 'ai_receptionist_test'
    });
  });

  test('honours TEST_DB_NAME', () => {
    const { testDbEnv } = loadConfig({ DATABASE_URL: 'postgres://u:p@localhost/main', TEST_DB_NAME: 'custom_test' });
    expect(testDbEnv().DB_NAME).toBe('custom_test');
  });
});

describe('test DB safety guard', () => {
  test('refuses to reset a database whose name does not end in _test, before connecting', async () => {
    Object.assign(process.env, { DATABASE_URL: 'postgres://u:p@localhost/main', TEST_DB_NAME: 'ai_receptionist' });
    const Client = jest.fn();
    const migrate = jest.fn();
    let prepareTestDb;
    jest.isolateModules(() => {
      // node-pg-migrate is ESM-only and can't load in Jest; neither should be reached anyway
      jest.doMock('pg', () => ({ Client }));
      jest.doMock('../migrate', () => ({ migrate }));
      prepareTestDb = require('../test-db');
    });

    await expect(prepareTestDb()).rejects.toThrow(/must end with _test/);
    expect(Client).not.toHaveBeenCalled();
    expect(migrate).not.toHaveBeenCalled();
  });
});
