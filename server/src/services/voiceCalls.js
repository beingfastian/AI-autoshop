// Call lifecycle for the voice agent, independent of the voice provider:
//   startCall      - a call comes in: which shop, answer / transfer / reject, agent config
//   markAnswered   - the agent picked up
//   findAvailability / bookFromCall - the agent's tools during the call
//   recordCallEnd  - end-of-call report: stored first (webhook_events), then processed, so a
//                    crash mid-processing can be retried and duplicate reports are ignored
const { DateTime } = require('luxon');
const { query, getClient } = require('../config/database');
const { getAvailableSlots } = require('./scheduling');
const { createBooking, parseRequestedTime, normalizePhone, BookingError, SchedulingError } = require('./bookings');
const { queueCallbackAlert } = require('./notifications');
const { buildAgentConfig } = require('./agentConfig');

const PROVIDER = 'voice-agent'; // webhook_events.provider for end-of-call reports
const MAX_REPORT_ATTEMPTS = 5;

class CallNotFoundError extends Error {
  constructor() {
    super('Call not found');
    this.name = 'CallNotFoundError';
  }
}

const text = (value, max) => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
};

async function loadCall(db, callId) {
  const { rows } = await db.query(
    `SELECT c.*, row_to_json(w.*) AS workshop
       FROM calls c JOIN workshops w ON w.id = c.workshop_id
      WHERE c.id = $1`,
    [callId]
  );
  if (!rows[0]) throw new CallNotFoundError();
  return rows[0];
}

/**
 * A call is ringing. Returns one of:
 *   { action: 'answer', call_id, agent }        - the AI takes the call
 *   { action: 'transfer', transfer_to, reason } - shop not taking AI calls: ring the shop instead
 *   { action: 'reject', reason }                - number not set up for any shop
 * Repeating the same providerCallId returns the same call (agents retry on timeouts).
 */
async function startCall({ providerCallId, toNumber, fromNumber }, { now = new Date() } = {}) {
  const called = normalizePhone(toNumber);
  const caller = normalizePhone(fromNumber);
  const { rows } = called
    ? await query('SELECT * FROM workshops WHERE ai_phone_number = $1', [called])
    : { rows: [] };
  const workshop = rows[0];

  if (!workshop) return { action: 'reject', reason: 'This number is not set up for any shop.' };
  if (workshop.status !== 'active') {
    return {
      action: 'transfer',
      transfer_to: workshop.transfer_phone || workshop.phone,
      reason: 'The shop is not taking AI calls right now.'
    };
  }

  const call = await query(
    `INSERT INTO calls (workshop_id, from_number, to_number, provider_call_id, status, started_at)
     VALUES ($1, $2, $3, $4, 'initiated', $5)
     ON CONFLICT (provider_call_id) DO UPDATE SET provider_call_id = EXCLUDED.provider_call_id
     RETURNING id, workshop_id`,
    [workshop.id, caller || text(fromNumber, 20) || 'unknown', called, text(providerCallId, 100), now]
  );
  if (call.rows[0].workshop_id !== workshop.id) {
    // Same provider call id already used for another shop: a bug or a forged request
    throw new Error(`provider_call_id ${providerCallId} belongs to another workshop`);
  }

  return {
    action: 'answer',
    call_id: call.rows[0].id,
    agent: buildAgentConfig(workshop, { now, callerNumber: caller })
  };
}

async function markAnswered(callId) {
  const { rowCount } = await query(
    `UPDATE calls SET status = 'in-progress', answered_at = COALESCE(answered_at, NOW())
      WHERE id = $1 AND status IN ('initiated', 'in-progress')`,
    [callId]
  );
  if (!rowCount) await loadCall({ query }, callId); // 404 if unknown; a finished call stays finished
}

// check_availability: up to 3 bookable times, starting from the requested day/time if given
async function findAvailability(callId, { preferred_date: date, preferred_time: time } = {}, { now = new Date() } = {}) {
  const call = await loadCall({ query }, callId);
  const zone = call.workshop.timezone;

  let from;
  let understood = true;
  if (date && time) {
    from = parseRequestedTime(date, time, zone);
    understood = Boolean(from);
  } else if (date) {
    const day = DateTime.fromISO(String(date), { zone });
    understood = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) && day.isValid;
    from = understood ? day.startOf('day').toJSDate() : null;
  }

  const slots = await getAvailableSlots({ query }, call.workshop, { from: from || undefined, now, limit: 3, days: 14 });
  const requested = from && date && time ? from.getTime() : null;
  return {
    slots: slots.map((s) => ({ start: s.start.toISOString(), spoken: s.local })),
    requested_time_available: requested !== null && slots.some((s) => s.start.getTime() === requested),
    ...(understood ? {} : { note: 'Could not read the requested date or time; ask the caller again.' })
  };
}

// book_appointment: always answers with something the agent can say; never throws for caller problems
async function bookFromCall(callId, args = {}, { now } = {}) {
  const call = await loadCall({ query }, callId);
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { booking, created } = await createBooking(
      client,
      {
        workshopId: call.workshop_id,
        callId,
        customer: {
          name: args.customer_name,
          phone: args.customer_phone,
          fallbackPhone: call.from_number,
          email: args.customer_email
        },
        vehicle: { make: args.vehicle_make, model: args.vehicle_model, year: args.vehicle_year },
        issue: { summary: args.issue_summary, category: args.issue_category, urgency: args.urgency },
        scheduledAt: args.start
      },
      { now }
    );
    await client.query('COMMIT');
    const spoken = DateTime.fromJSDate(booking.scheduled_at).setZone(call.workshop.timezone).toFormat("cccc, LLLL d 'at' h:mm a");
    return created
      ? { booked: true, booking_id: booking.id, spoken }
      : { booked: true, booking_id: booking.id, spoken, note: 'This call already has this booking; do not book again.' };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof SchedulingError) {
      const alternatives = await getAvailableSlots({ query }, call.workshop, { now, limit: 3, days: 14 }).catch(() => []);
      return {
        booked: false,
        code: error.code,
        reason: error.message,
        alternatives: alternatives.map((s) => ({ start: s.start.toISOString(), spoken: s.local }))
      };
    }
    if (error instanceof BookingError) {
      return { booked: false, code: error.code, reason: error.message, missing: error.details || [] };
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * End-of-call report from the agent. Stored, then processed. Returns { duplicate } so the
 * caller knows a repeated report was ignored.
 * report: { ended_reason, started_at, ended_at, duration_seconds, transcript, recording_url, cost_usd,
 *           summary, outcome: { booking_requested, callback_requested, customer_name, customer_phone,
 *                               vehicle_make, vehicle_model, issue_summary, sentiment } }
 */
async function recordCallEnd(callId, report = {}) {
  await loadCall({ query }, callId); // 404 for unknown calls before storing anything
  const { rows } = await query(
    `INSERT INTO webhook_events (provider, event_type, dedupe_key, payload)
     VALUES ($1, 'call-ended', $2, $3)
     ON CONFLICT (provider, dedupe_key) DO NOTHING
     RETURNING id`,
    [PROVIDER, `call-ended:${callId}`, JSON.stringify({ call_id: callId, report })]
  );
  if (!rows[0]) return { duplicate: true };
  await processCallReport(rows[0].id);
  return { duplicate: false };
}

/** Processes one stored end-of-call report. Safe to run again (the worker retries failures). */
async function processCallReport(eventId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const event = (await client.query(
      `SELECT * FROM webhook_events WHERE id = $1 AND status IN ('received', 'failed') FOR UPDATE SKIP LOCKED`,
      [eventId]
    )).rows[0];
    if (!event) {
      await client.query('COMMIT'); // already processed, or another worker has it
      return;
    }

    try {
      await client.query('SAVEPOINT report');
      await applyCallReport(client, event.payload.call_id, event.payload.report || {});
      await client.query(
        `UPDATE webhook_events SET status = 'processed', processed_at = NOW(), attempts = attempts + 1, last_error = NULL WHERE id = $1`,
        [eventId]
      );
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT report');
      await client.query(
        `UPDATE webhook_events SET status = 'failed', attempts = attempts + 1, last_error = $2 WHERE id = $1`,
        [eventId, String(error.message).slice(0, 1000)]
      );
      console.error(`❌ Could not process call report ${eventId}:`, error);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function applyCallReport(client, callId, report) {
  const outcome = report.outcome || {};
  const started = report.started_at ? new Date(report.started_at) : null;
  const ended = report.ended_at ? new Date(report.ended_at) : null;
  let duration = Number.isFinite(Number(report.duration_seconds)) ? Math.round(Number(report.duration_seconds)) : null;
  if (duration === null && started && ended && ended > started) duration = Math.round((ended - started) / 1000);

  await client.query(
    `UPDATE calls SET
       status = 'completed',
       ended_at = COALESCE($2, NOW()),
       duration_seconds = $3,
       transcript = $4,
       recording_url = $5,
       cost_usd = $6,
       ended_reason = $7
     WHERE id = $1`,
    [
      callId,
      ended && !Number.isNaN(ended.getTime()) ? ended : null,
      duration,
      text(report.transcript, 200000),
      text(report.recording_url, 2000),
      Number.isFinite(Number(report.cost_usd)) ? Number(report.cost_usd) : 0,
      text(report.ended_reason, 100)
    ]
  );

  const booked = (await client.query('SELECT 1 FROM bookings WHERE call_id = $1', [callId])).rowCount > 0;
  // A caller who wanted something we didn't deliver must not be lost: the shop calls them back
  const callback = !booked && Boolean(outcome.booking_requested || outcome.callback_requested);

  await client.query(
    `INSERT INTO call_analysis (
       call_id, structured_data, customer_name, customer_phone, vehicle_make, vehicle_model,
       issue_keywords, sentiment, booking_created, callback_requested
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (call_id) DO UPDATE SET
       structured_data = EXCLUDED.structured_data, customer_name = EXCLUDED.customer_name,
       customer_phone = EXCLUDED.customer_phone, vehicle_make = EXCLUDED.vehicle_make,
       vehicle_model = EXCLUDED.vehicle_model, issue_keywords = EXCLUDED.issue_keywords,
       sentiment = EXCLUDED.sentiment, booking_created = EXCLUDED.booking_created,
       callback_requested = EXCLUDED.callback_requested`,
    [
      callId,
      JSON.stringify({ summary: text(report.summary, 5000), ...outcome }),
      text(outcome.customer_name, 255),
      normalizePhone(outcome.customer_phone) || text(outcome.customer_phone, 20),
      text(outcome.vehicle_make, 100),
      text(outcome.vehicle_model, 100),
      text(outcome.issue_summary, 5000),
      ['positive', 'neutral', 'negative'].includes(outcome.sentiment) ? outcome.sentiment : 'neutral',
      booked,
      callback
    ]
  );

  if (callback) await queueCallbackAlert(client, callId);
}

/** Retries stored reports that failed or were never processed (worker). Returns how many ran. */
async function retryCallReports({ olderThanSeconds = 60, limit = 20 } = {}) {
  const { rows } = await query(
    `SELECT id FROM webhook_events
      WHERE provider = $1 AND status IN ('received', 'failed') AND attempts < $2
        AND received_at < NOW() - make_interval(secs => $3)
      ORDER BY received_at LIMIT $4`,
    [PROVIDER, MAX_REPORT_ATTEMPTS, olderThanSeconds, limit]
  );
  for (const { id } of rows) await processCallReport(id);
  return rows.length;
}

module.exports = {
  startCall,
  markAnswered,
  findAvailability,
  bookFromCall,
  recordCallEnd,
  processCallReport,
  retryCallReports,
  CallNotFoundError
};
