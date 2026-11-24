// Background jobs over HTTP, for hosts without an always-on worker (Vercel). A scheduler calls
//   GET or POST /api/jobs/tick   with   Authorization: Bearer <CRON_SECRET>
// every minute (Vercel's own cron sends exactly this header; on the free plan it only runs daily,
// so a free external scheduler does the per-minute calls). Each tick does what the worker's loops
// do once. Safe to run twice at the same time: the outbox claims rows with SKIP LOCKED and every
// job is idempotent.
const crypto = require('crypto');
const express = require('express');
const { sendDueNotifications, sweepReminders } = require('../services/notifications');
const { retryCallReports } = require('../services/voiceCalls');

const router = express.Router();

function authorized(req) {
  const expected = process.env.CRON_SECRET;
  const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (!expected || !match) return false;
  const a = crypto.createHash('sha256').update(match[1]).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

async function tick(req, res, next) {
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: 'Jobs endpoint is not configured (CRON_SECRET)' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  const started = Date.now();
  try {
    const reminders = await sweepReminders();
    const notifications = await sendDueNotifications({ limit: 50 });
    const callReports = await retryCallReports();
    res.json({ ok: true, reminders_queued: reminders, notifications, call_reports_retried: callReports, ms: Date.now() - started });
  } catch (error) {
    next(error);
  }
}

router.get('/tick', tick);
router.post('/tick', tick);

module.exports = router;
