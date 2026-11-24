// Vercel entry point (zero-config Express looks for index.js). Checks the configuration first so a
// deployment with missing or invalid settings fails loudly instead of half-working, then exports
// the app. Locally and on servers, src/server.js (API) and src/worker.js (jobs) are used instead.
require('dotenv').config();
require('./src/config/env').validateEnv();

module.exports = require('./src/app');
