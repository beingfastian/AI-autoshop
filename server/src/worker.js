// server/src/worker.js - background process: sends queued notifications and queues reminders.
// Run exactly one or several; the outbox claims rows with SKIP LOCKED, so workers never double-send.
require('dotenv').config();

const { pool } = require('./config/database');
const { sendDueNotifications, sweepReminders } = require('./services/notifications');

const SEND_INTERVAL_MS = 5 * 1000; // confirmations go out within seconds of a booking
const REMINDER_INTERVAL_MS = 15 * 60 * 1000;

// Runs `task` now and then every `intervalMs` after it finishes. A failing run is logged and the
// loop carries on; runs never overlap. stop() waits for a run in progress to finish.
function every(name, intervalMs, task, logger) {
  let timer = null;
  let running = null;
  let stopped = false;

  const run = async () => {
    if (stopped) return;
    running = Promise.resolve()
      .then(task)
      .catch((error) => logger.error(`❌ ${name} failed:`, error))
      .finally(() => {
        running = null;
        if (!stopped) timer = setTimeout(run, intervalMs);
      });
  };
  run();

  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}

function startWorker({ logger = console, sendIntervalMs = SEND_INTERVAL_MS, reminderIntervalMs = REMINDER_INTERVAL_MS } = {}) {
  const stops = [
    every('Reminder sweep', reminderIntervalMs, async () => {
      const added = await sweepReminders();
      if (added) logger.log(`🔔 Queued ${added} reminder(s)`);
    }, logger),
    every('Notification sender', sendIntervalMs, async () => {
      const counts = await sendDueNotifications({ logger });
      if (counts.sent || counts.failed || counts.retrying || counts.skipped) logger.log('📨 Notifications:', counts);
    }, logger)
  ];
  return { stop: () => Promise.all(stops.map((stop) => stop())) };
}

if (require.main === module) {
  try {
    require('./config/env').validateEnv();
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  const worker = startWorker();
  console.log('⚙️ Worker started');

  const shutdown = async (signal) => {
    console.log(`${signal} received, finishing current work...`);
    await worker.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { startWorker, SEND_INTERVAL_MS, REMINDER_INTERVAL_MS };
