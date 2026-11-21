// Shared DB connection settings for the root scripts (migrations, seed, test DB).
// DATABASE_URL wins if set; otherwise the same DB_* variables the services use.
// Root .env is read first; server/.env is the fallback so local setup needs only one env file.
const path = require('path');
const dotenv = require('dotenv');

const ROOT = path.join(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
dotenv.config({ path: path.join(ROOT, 'server', '.env'), quiet: true });

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'ai_receptionist_test';

// pg lets values parsed from a connection string override separate fields,
// so a different database has to be swapped into the URL itself
function withDatabase(connectionString, database) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

function connectionConfig(database) {
  if (process.env.DATABASE_URL) {
    const url = process.env.DATABASE_URL;
    return { connectionString: database ? withDatabase(url, database) : url };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: database || process.env.DB_NAME || 'ai_receptionist',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  };
}

// The services only read DB_*, so tests hand them the same test DB connection the
// setup scripts use, as DB_* values (whether it was configured via DATABASE_URL or DB_*)
function testDbEnv() {
  const cfg = connectionConfig(TEST_DB_NAME);
  let env;

  if (cfg.connectionString) {
    const url = new URL(cfg.connectionString);
    const sslmode = url.searchParams.get('sslmode');
    env = {
      DB_HOST: url.hostname.replace(/^\[(.*)\]$/, '$1'), // strip IPv6 brackets
      DB_PORT: url.port || '5432',
      DB_USER: decodeURIComponent(url.username) || undefined,
      DB_PASSWORD: decodeURIComponent(url.password) || undefined,
      DB_SSL: String(Boolean(sslmode) && sslmode !== 'disable')
    };
  } else {
    env = {
      DB_HOST: cfg.host,
      DB_PORT: String(cfg.port),
      DB_USER: cfg.user,
      DB_PASSWORD: cfg.password,
      DB_SSL: String(Boolean(cfg.ssl))
    };
  }

  env.DB_NAME = TEST_DB_NAME;
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined));
}

module.exports = { ROOT, TEST_DB_NAME, connectionConfig, testDbEnv };
