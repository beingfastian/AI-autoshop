// server/src/config/database.js
// One connection pool per process. DATABASE_URL (e.g. Neon) wins over the DB_* variables.
// On serverless hosts many instances each open a pool, so keep DB_POOL_MAX small there and use
// the provider's pooled connection string.
const { Pool } = require('pg');
require('dotenv').config();

const common = {
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
};

const pool = new Pool(
  process.env.DATABASE_URL
    ? { ...common, connectionString: process.env.DATABASE_URL } // sslmode in the URL controls TLS
    : {
        ...common,
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || 'ai_receptionist',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
      }
);

pool.on('connect', () => console.log('✅ Database connected successfully'));
// An idle client lost its connection (e.g. DB restart). pg drops that client and the
// pool opens a new one on the next query, so log it instead of killing the process.
pool.on('error', (err) => {
  console.error('❌ Unexpected database error on an idle client:', err.message);
});

const query = async (text, params) => {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 100) console.warn(`⚠️ Slow query (${duration}ms): ${text}`);
  return res;
};

const getClient = () => pool.connect();

module.exports = { pool, query, getClient };
