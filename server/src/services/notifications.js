// Notifications outbox: every email/SMS we intend to send is a row in `notifications`.
//
// - queueBookingNotifications() writes the rows inside the booking's own transaction, so a booking
//   that rolls back can never send anything.
// - sweepReminders() adds 24h/2h reminder rows when they become due; the unique key on
//   (booking, kind, channel, recipient) makes repeated sweeps harmless.
// - sendDueNotifications() (run by the worker) claims one due row at a time with
//   FOR UPDATE SKIP LOCKED, so several workers never send the same message, re-checks that it
//   still makes sense to send (booking not cancelled, appointment not past), sends it, and
//   records the outcome. Temporary failures retry with backoff; after MAX_ATTEMPTS, or on a
//   permanent error (e.g. invalid address), the row is marked failed.
//
// Delivery is at-least-once only if a worker dies between the provider accepting a message and
// the row being marked sent; in every other case each row is sent at most once.
const { query: poolQuery, getClient } = require('../config/database');
const {
  sendBookingConfirmationCustomer,
  sendBookingNotificationWorkshop,
  sendBookingReminder,
  sendCallbackRequest
} = require('../config/sendgrid');
const { sendSms, smsEnabled } = require('./sms');

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MINUTES = [1, 5, 15, 60];
const REMINDERS = [
  // kind, hours before the appointment; a reminder is only sent while it is still useful
  // (24h one stops once the 2h one is due) and only if the booking was made before it was due
  { kind: 'reminder_24h', hours: 24, until: 2 },
  { kind: 'reminder_2h', hours: 2, until: 0 }
];
const ACTIVE_BOOKING = 'confirmed';

const lower = (v) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null);
const unique = (list) => [...new Set(list.filter(Boolean))];

/** Queues the confirmation messages for a new booking. Call inside the booking's transaction. */
async function queueBookingNotifications(client, bookingId) {
  const { rows } = await client.query(
    `SELECT c.email AS customer_email, c.phone AS customer_phone,
            w.email AS workshop_email, w.notify_emails, w.notify_sms
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       JOIN workshops w ON w.id = b.workshop_id
      WHERE b.id = $1`,
    [bookingId]
  );
  const b = rows[0];
  if (!b) return;

  const messages = [];
  const customerEmail = lower(b.customer_email);
  if (customerEmail) messages.push(['email', 'booking_confirmation_customer', customerEmail]);
  for (const email of unique([lower(b.workshop_email), ...(b.notify_emails || []).map(lower)])) {
    messages.push(['email', 'booking_notification_workshop', email]);
  }
  if (smsEnabled()) {
    if (b.customer_phone) messages.push(['sms', 'booking_confirmation_customer', b.customer_phone]);
    for (const phone of unique(b.notify_sms || [])) messages.push(['sms', 'booking_notification_workshop', phone]);
  }

  for (const [channel, kind, recipient] of messages) {
    await client.query(
      `INSERT INTO notifications (booking_id, channel, kind, recipient)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [bookingId, channel, kind, recipient]
    );
  }
}

/**
 * Alerts the shop that a caller needs a call back (they wanted a booking the AI couldn't make).
 * Call inside the transaction that records the call's outcome.
 */
async function queueCallbackAlert(client, callId) {
  const { rows } = await client.query(
    `SELECT w.email, w.notify_emails, w.notify_sms
       FROM calls c JOIN workshops w ON w.id = c.workshop_id WHERE c.id = $1`,
    [callId]
  );
  const w = rows[0];
  if (!w) return;
  const messages = unique([lower(w.email), ...(w.notify_emails || []).map(lower)]).map((r) => ['email', r]);
  if (smsEnabled()) for (const phone of unique(w.notify_sms || [])) messages.push(['sms', phone]);
  for (const [channel, recipient] of messages) {
    await client.query(
      `INSERT INTO notifications (call_id, channel, kind, recipient)
       VALUES ($1, $2, 'callback_requested', $3)
       ON CONFLICT DO NOTHING`,
      [callId, channel, recipient]
    );
  }
}

async function loadCallDetails(db, callId) {
  const { rows } = await db.query(
    `SELECT c.id, c.from_number, c.started_at, c.provider_call_id,
            a.customer_name, a.customer_phone, a.issue_keywords AS issue_summary,
            a.structured_data ->> 'summary' AS summary,
            w.name AS workshop_name, w.timezone AS workshop_timezone
       FROM calls c
       JOIN workshops w ON w.id = c.workshop_id
       LEFT JOIN call_analysis a ON a.call_id = c.id
      WHERE c.id = $1`,
    [callId]
  );
  return rows[0];
}

/** Adds reminder rows that have become due. Safe to run as often as you like. Returns rows added. */
async function sweepReminders({ now = new Date(), db = { query: poolQuery } } = {}) {
  const channels = [['email', 'lower(c.email)', 'c.email IS NOT NULL']];
  if (smsEnabled()) channels.push(['sms', 'c.phone', 'c.phone IS NOT NULL']);

  let added = 0;
  for (const { kind, hours, until } of REMINDERS) {
    for (const [channel, recipient, hasRecipient] of channels) {
      const { rowCount } = await db.query(
        `INSERT INTO notifications (booking_id, channel, kind, recipient, send_after)
         SELECT b.id, $1, $2, ${recipient}, $3
           FROM bookings b JOIN customers c ON c.id = b.customer_id
          WHERE b.status = $6
            AND ${hasRecipient}
            AND b.scheduled_at - make_interval(hours => $4) <= $3
            AND b.scheduled_at - make_interval(hours => $5) > $3
            AND b.created_at <= b.scheduled_at - make_interval(hours => $4)
         ON CONFLICT DO NOTHING`,
        [channel, kind, now, hours, until, ACTIVE_BOOKING]
      );
      added += rowCount;
    }
  }
  return added;
}

/**
 * Removes reminders for a booking whose time changed, so the new time gets its own reminders.
 * Call inside the transaction that changes scheduled_at.
 */
async function resetReminders(client, bookingId) {
  await client.query(`DELETE FROM notifications WHERE booking_id = $1 AND kind LIKE 'reminder_%'`, [bookingId]);
}

async function loadBookingDetails(db, bookingId) {
  const { rows } = await db.query(
    `SELECT b.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
            v.make AS vehicle_make, v.model AS vehicle_model, v.year AS vehicle_year,
            w.name AS workshop_name, w.email AS workshop_email, w.phone AS workshop_phone,
            w.address AS workshop_address, w.timezone AS workshop_timezone
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       LEFT JOIN vehicles v ON v.id = b.vehicle_id
       JOIN workshops w ON w.id = b.workshop_id
      WHERE b.id = $1`,
    [bookingId]
  );
  return rows[0];
}

// Appointment date and time in the shop's timezone (servers usually run in UTC)
function formatAppointment(booking) {
  const date = new Date(booking.scheduled_at);
  const timeZone = booking.workshop_timezone;
  return {
    scheduledDate: date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone }),
    scheduledTime: date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone })
  };
}

function smsText(kind, b, when) {
  const at = `${when.scheduledDate} at ${when.scheduledTime}`;
  switch (kind) {
    case 'booking_confirmation_customer':
      return `${b.workshop_name}: your appointment is confirmed for ${at}. To change it call ${b.workshop_phone}.`;
    case 'booking_notification_workshop':
      return `New booking: ${b.customer_name} (${b.customer_phone}) on ${at}. ${b.issue_summary}`.slice(0, 320);
    case 'reminder_24h':
      return `${b.workshop_name}: reminder, your appointment is tomorrow, ${at}. Call ${b.workshop_phone} to reschedule.`;
    case 'reminder_2h':
      return `${b.workshop_name}: reminder, your appointment is in about 2 hours (${when.scheduledTime}).`;
    default:
      return null;
  }
}

// Sends one message; returns the provider's message id
async function deliver(notification, booking) {
  if (notification.kind === 'callback_requested') return deliverCallbackAlert(notification, booking);
  const when = formatAppointment(booking);

  if (notification.channel === 'sms') {
    const body = smsText(notification.kind, booking, when);
    if (!body) throw Object.assign(new Error(`No SMS text for ${notification.kind}`), { permanent: true });
    return sendSms({ to: notification.recipient, body });
  }

  const common = {
    customerName: booking.customer_name,
    workshopName: booking.workshop_name,
    workshopPhone: booking.workshop_phone,
    vehicleMake: booking.vehicle_make || 'Your vehicle',
    vehicleModel: booking.vehicle_model || '',
    bookingId: booking.id,
    ...when
  };
  let response;
  switch (notification.kind) {
    case 'booking_confirmation_customer':
      response = await sendBookingConfirmationCustomer({
        ...common,
        customerEmail: notification.recipient,
        workshopAddress: booking.workshop_address,
        issueSummary: booking.issue_summary
      });
      break;
    case 'booking_notification_workshop':
      response = await sendBookingNotificationWorkshop({
        ...common,
        workshopEmail: notification.recipient,
        customerPhone: booking.customer_phone,
        customerEmail: booking.customer_email,
        vehicleMake: booking.vehicle_make || 'Unknown',
        vehicleYear: booking.vehicle_year || '',
        issueSummary: booking.issue_summary,
        issueCategory: booking.issue_category,
        urgency: booking.urgency,
        dashboardUrl: process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000'
      });
      break;
    case 'reminder_24h':
    case 'reminder_2h':
      response = await sendBookingReminder({
        ...common,
        customerEmail: notification.recipient,
        hoursUntil: notification.kind === 'reminder_24h' ? 24 : 2
      });
      break;
    default:
      throw Object.assign(new Error(`No email template for ${notification.kind}`), { permanent: true });
  }
  return response?.[0]?.headers?.['x-message-id'] || null;
}

// The caller details the shop needs to phone them back
async function deliverCallbackAlert(notification, call) {
  const phone = call.customer_phone || call.from_number;
  const name = call.customer_name || 'A caller';
  const when = new Date(call.started_at).toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: call.workshop_timezone
  });
  if (notification.channel === 'sms') {
    return sendSms({ to: notification.recipient, body: `Call back needed: ${name} (${phone}) called ${when}. ${call.issue_summary || ''}`.slice(0, 320) });
  }
  const response = await sendCallbackRequest({
    workshopEmail: notification.recipient,
    workshopName: call.workshop_name,
    customerName: name,
    customerPhone: phone,
    callTime: when,
    issueSummary: call.issue_summary,
    summary: call.summary
  });
  return response?.[0]?.headers?.['x-message-id'] || null;
}

// Why a queued message should no longer go out, or null if it should
function reasonToSkip(notification, booking, now) {
  if (notification.call_id) return booking ? null : 'call no longer exists';
  if (!booking) return 'booking no longer exists';
  if (booking.status !== ACTIVE_BOOKING) return `booking is ${booking.status}`;
  if (notification.kind.startsWith('reminder_') && new Date(booking.scheduled_at) <= now) return 'appointment already started';
  return null;
}

// 4xx (except 429 rate limit) won't succeed on retry: bad address, unverified sender, bad number
function isPermanent(error) {
  if (error.permanent) return true;
  const status = Number(error.code || error.status || error.response?.statusCode);
  return status >= 400 && status < 500 && status !== 429;
}

const describe = (error) => {
  const detail = error.response?.body?.errors?.map((e) => e.message).join('; ');
  return String(detail || error.message || error).slice(0, 1000);
};

/**
 * Sends notifications that are due. Returns counts: { sent, retrying, failed, skipped }.
 * @param options { now = new Date(), limit = 20, logger = console }
 */
async function sendDueNotifications({ now = new Date(), limit = 20, logger = console } = {}) {
  const counts = { sent: 0, retrying: 0, failed: 0, skipped: 0 };

  for (let i = 0; i < limit; i++) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT * FROM notifications
          WHERE status = 'pending' AND send_after <= $1
          ORDER BY send_after
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [now]
      );
      const notification = rows[0];
      if (!notification) {
        await client.query('COMMIT');
        break;
      }

      // Messages are about a booking, or (callback alerts) about a call
      const booking = notification.call_id
        ? await loadCallDetails(client, notification.call_id)
        : await loadBookingDetails(client, notification.booking_id);
      const skip = reasonToSkip(notification, booking, now);
      if (skip) {
        await client.query(
          `UPDATE notifications SET status = 'skipped', last_error = $2 WHERE id = $1`,
          [notification.id, skip]
        );
        counts.skipped++;
      } else {
        try {
          const messageId = await deliver(notification, booking);
          await client.query(
            `UPDATE notifications
                SET status = 'sent', sent_at = NOW(), attempts = attempts + 1,
                    provider_message_id = $2, last_error = NULL
              WHERE id = $1`,
            [notification.id, messageId]
          );
          counts.sent++;
        } catch (error) {
          const attempts = notification.attempts + 1;
          const giveUp = attempts >= MAX_ATTEMPTS || isPermanent(error);
          const delay = RETRY_DELAYS_MINUTES[Math.min(attempts - 1, RETRY_DELAYS_MINUTES.length - 1)];
          await client.query(
            `UPDATE notifications
                SET attempts = $2, last_error = $3,
                    status = CASE WHEN $4 THEN 'failed' ELSE 'pending' END,
                    send_after = CASE WHEN $4 THEN send_after ELSE $5::timestamptz + make_interval(mins => $6) END
              WHERE id = $1`,
            [notification.id, attempts, describe(error), giveUp, now, delay]
          );
          const label = `${notification.channel} ${notification.kind} for ${notification.call_id ? `call ${notification.call_id}` : `booking ${notification.booking_id}`}`;
          if (giveUp) {
            counts.failed++;
            logger.error(`❌ Giving up on ${label} after ${attempts} attempt(s): ${describe(error)}`);
          } else {
            counts.retrying++;
            logger.warn(`⚠️ ${label} failed (attempt ${attempts}), retrying in ${delay} min: ${describe(error)}`);
          }
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return counts;
}

/** Pending messages that should have gone out more than `minutes` ago (worker down or stuck). */
async function overdueCount(minutes = 5) {
  const { rows } = await poolQuery(
    `SELECT COUNT(*)::int AS n FROM notifications
      WHERE status = 'pending' AND send_after < NOW() - make_interval(mins => $1)`,
    [minutes]
  );
  return rows[0].n;
}

module.exports = {
  queueBookingNotifications,
  queueCallbackAlert,
  sweepReminders,
  resetReminders,
  sendDueNotifications,
  overdueCount,
  MAX_ATTEMPTS
};
