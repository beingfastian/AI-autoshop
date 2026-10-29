// voice-service/src/config/database.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'ai_receptionist',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,

  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => console.log('✅ Database connected successfully'));
pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
  process.exit(1);
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
