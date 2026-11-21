// Runs once in the real Jest process (setupFiles only see a sandboxed copy of process.env).
// TZ=UTC makes every run behave like a production server, so timezone bugs show up on any machine.
process.env.TZ = 'UTC';

// Reset the test database and apply all migrations once before the suite runs
module.exports = require('../../scripts/test-db');
