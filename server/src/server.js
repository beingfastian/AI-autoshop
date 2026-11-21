// server/src/server.js - API process: validates config, then starts the HTTP server
require('dotenv').config();
const { validateEnv } = require('./config/env');

try {
  validateEnv();
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}

const app = require('./app');
const { pool } = require('./config/database');

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`🎙️ API running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing...');
  server.close(() => pool.end(() => process.exit(0)));
});
