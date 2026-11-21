// server/src/server.js - API process: starts the HTTP server
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
