// voice-service/src/routes/webhooks.js
const express = require('express');
const router = express.Router();
const { query, getClient } = require('../config/database');
const { createBooking, parseRequestedTime, BookingError, SchedulingError } = require('../services/bookings');
const { isUuid } = require('../utils/ids');

// -----------------------------
// Auth: Bearer token from Vapi
// -----------------------------
function verifyVapiBearer(req, res, next) {
  const auth = req.headers.authorization || '';
  const expected = `Bearer ${process.env.VAPI_WEBHOOK_SECRET}`;

  // If you want to allow local testing without auth, comment this out.
  if (auth !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Helpers to support both Vapi payload shapes
function unwrapVapi(reqBody) {
  // New format: { message: { type, call, analysis, ... } }
  if (reqBody && reqBody.message && typeof reqBody.message === 'object') {
    return reqBody.message;
  }
  // Old format: { call, analysis, metadata }
  return reqBody;
}

function pickMetadata(msg) {
  // Vapi may place metadata in different places depending on event
  return (
    msg?.metadata ||
    msg?.call?.metadata ||
    msg?.call?.assistant?.metadata ||
    msg?.call?.customer?.metadata ||
    {}
  );
}

/**
 * POST /api/webhooks/vapi/call-started
 */
router.post('/vapi/call-started', verifyVapiBearer, async (req, res) => {
  try {
    const msg = unwrapVapi(req.body);
    const metadata = pickMetadata(msg);
    const callId = metadata.call_id;

    if (!isUuid(callId)) {
      return res.status(200).json({ received: true, warning: 'Missing or invalid metadata.call_id' });
    }

    await query(
      `UPDATE calls SET status = 'in-progress', answered_at = NOW() WHERE id = $1`,
      [callId]
    );

    console.log(`📞 Call started: ${callId}`);
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('call-started webhook error:', e);
    return res.status(200).json({ received: true });
  }
});

/**
 * POST /api/webhooks/vapi/call-ended
 * Handles: end-of-call-report (recommended)
 */
router.post('/vapi/call-ended', verifyVapiBearer, async (req, res) => {
  const start = Date.now();

  try {
    const msg = unwrapVapi(req.body);
    const eventType = msg?.type || 'unknown';
    const metadata = pickMetadata(msg);

    // IMPORTANT: respond quickly
    res.status(200).json({ received: true });

    const callId = metadata.call_id;

    const callObj = msg?.call || req.body?.call || {};
    const analysis = msg?.analysis || req.body?.analysis || {};

    if (!isUuid(callId)) {
      console.warn('⚠️ call-ended: missing or invalid metadata.call_id', { eventType });
      return;
    }

    console.log(`📞 Call ended: ${callId} (event: ${eventType})`);

    const result = await processCallEnded({
      callId,
      vapiCallId: callObj.id,
      duration: callObj.duration,
      cost: callObj.cost || 0,
      endReason: callObj.endedReason || callObj.ended_reason,
      recording: callObj.recordingUrl || callObj.recording_url,
      transcript: callObj.transcript,
      structuredData: analysis?.structuredData || analysis?.structured_data || {},
      sentiment: analysis?.sentiment
    });

    console.log(`✅ call-ended processed in ${Date.now() - start}ms`);
    if (result.created) console.log(`📅 Booking ${result.booking.id} created from call ${callId}`);
  } catch (e) {
    console.error('❌ call-ended webhook error:', e);
    // Already responded 200 above in success path; but if error happened before response:
    try { res.status(200).json({ received: true }); } catch (_) { /* response already sent */ }
  }
});

// -----------------------------
// Processing logic
// -----------------------------

// Saves the call, its analysis and (if the caller confirmed one) the booking in one transaction.
// A booking that can't be made (unreadable or unavailable time, missing details) never loses the
// call: the analysis is saved with callback_requested = true so the shop can call the customer back.
async function processCallEnded(data) {
  const { callId, duration, cost, endReason, recording, transcript, structuredData, sentiment } = data;

  const client = await getClient();
  let booking = null;
  let created = false;

  try {
    await client.query('BEGIN');

    // The shop comes from our own call record, not from webhook metadata
    const callRow = await client.query(
      `UPDATE calls SET
        status = 'completed',
        ended_at = NOW(),
        duration_seconds = $1,
        cost_usd = $2,
        recording_url = $3,
        transcript = $4,
        ended_reason = $5
      WHERE id = $6
      RETURNING workshop_id, from_number`,
      [
        Number.isFinite(Number(duration)) ? Math.round(Number(duration)) : null,
        Number.isFinite(Number(cost)) ? Number(cost) : 0,
        recording || null,
        transcript || null,
        endReason ? String(endReason).slice(0, 100) : null,
        callId
      ]
    );
    if (callRow.rows.length === 0) {
      await client.query('ROLLBACK');
      console.warn(`⚠️ call-ended for unknown call ${callId}; ignored`);
      return { booking: null, created: false };
    }
    const { workshop_id: workshopId, from_number: callerId } = callRow.rows[0];

    await client.query(
      `INSERT INTO call_analysis (
        call_id, structured_data, customer_name, customer_phone,
        vehicle_make, vehicle_model, issue_keywords, sentiment
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (call_id) DO UPDATE SET
        structured_data = EXCLUDED.structured_data,
        customer_name = EXCLUDED.customer_name,
        customer_phone = EXCLUDED.customer_phone,
        vehicle_make = EXCLUDED.vehicle_make,
        vehicle_model = EXCLUDED.vehicle_model,
        issue_keywords = EXCLUDED.issue_keywords,
        sentiment = EXCLUDED.sentiment`,
      [
        callId,
        JSON.stringify(structuredData || {}),
        trimmed(structuredData?.customer_name, 255),
        trimmed(structuredData?.customer_phone, 20),
        trimmed(structuredData?.vehicle_make, 100),
        trimmed(structuredData?.vehicle_model, 100),
        trimmed(structuredData?.issue_summary, 5000),
        trimmed(sentiment?.label || sentiment, 20) || 'neutral'
      ]
    );

    let callbackReason = null;
    if (structuredData?.booking_confirmed) {
      const outcome = await bookFromCall(client, { callId, workshopId, callerId, structuredData });
      booking = outcome.booking;
      created = outcome.created;
      callbackReason = outcome.callbackReason;
    }

    await client.query(
      `UPDATE call_analysis SET booking_created = $2, callback_requested = $3 WHERE call_id = $1`,
      [callId, Boolean(booking), Boolean(callbackReason)]
    );
    await client.query('COMMIT');

    if (callbackReason) console.warn(`⚠️ Call ${callId} needs a callback: ${callbackReason}`);
    return { booking, created };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Books the time the caller asked for. Returns { booking } or { callbackReason } - never throws for
// a booking the caller can't have, so the call itself is always saved.
async function bookFromCall(client, { callId, workshopId, callerId, structuredData }) {
  const { rows } = await client.query('SELECT timezone FROM workshops WHERE id = $1', [workshopId]);
  const scheduledAt = parseRequestedTime(structuredData.preferred_date, structuredData.preferred_time, rows[0]?.timezone);
  if (!scheduledAt) {
    return { callbackReason: `requested time not understood (${structuredData.preferred_date} ${structuredData.preferred_time})` };
  }

  // Insurance, not dead code: createBooking() currently runs every check before its first write,
  // so a refused booking leaves nothing behind. If a check is ever added after a write (customer,
  // vehicle), this savepoint stops that half-made booking from being committed with the call.
  await client.query('SAVEPOINT booking');
  try {
    const result = await createBooking(client, {
      workshopId,
      callId,
      customer: {
        name: structuredData.customer_name,
        phone: structuredData.customer_phone,
        fallbackPhone: callerId,
        email: structuredData.customer_email
      },
      vehicle: { make: structuredData.vehicle_make, model: structuredData.vehicle_model, year: structuredData.vehicle_year },
      issue: { summary: structuredData.issue_summary, category: structuredData.issue_category, urgency: structuredData.urgency },
      scheduledAt
    });
    await client.query('RELEASE SAVEPOINT booking');
    return { booking: result.booking, created: result.created };
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT booking');
    if (e instanceof BookingError || e instanceof SchedulingError) {
      return { callbackReason: `${e.code}: ${e.message}` };
    }
    throw e;
  }
}

function trimmed(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

module.exports = router;
