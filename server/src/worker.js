// server/src/worker.js - background process: scheduled jobs, kept out of the API process
const cron = require('node-cron');
require('dotenv').config();

const { pool } = require('./config/database');
const { sendReminders } = require('./jobs/reminders');

// Send reminder emails every hour
const REMINDER_SCHEDULE = '0 * * * *';

function startWorker() {
  const reminderTask = cron.schedule(REMINDER_SCHEDULE, async () => {
    console.log('🔔 Running reminder job...');
    try {
      await sendReminders();
    } catch (error) {
      console.error('Reminder job failed:', error);
    }
  });
  return [reminderTask];
}

if (require.main === module) {
  const tasks = startWorker();
  console.log('⚙️ Worker started');

  process.on('SIGTERM', () => {
    tasks.forEach((task) => task.stop());
    pool.end(() => process.exit(0));
  });
}

module.exports = { startWorker, REMINDER_SCHEDULE };
