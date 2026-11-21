// voice-service/src/routes/webhooks.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { query, getClient } = require('../config/database');

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

    if (!callId) {
      return res.status(200).json({ received: true, warning: 'Missing metadata.call_id' });
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
    const workshopId = metadata.workshop_id;

    const callObj = msg?.call || req.body?.call || {};
    const analysis = msg?.analysis || req.body?.analysis || {};

    if (!callId) {
      console.warn('⚠️ call-ended: missing metadata.call_id', { eventType });
      return;
    }

    console.log(`📞 Call ended: ${callId} (event: ${eventType})`);

    await processCallEnded({
      callId,
      workshopId,
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
  } catch (e) {
    console.error('❌ call-ended webhook error:', e);
    // Already responded 200 above in success path; but if error happened before response:
    try { res.status(200).json({ received: true }); } catch (_) { /* response already sent */ }
  }
});

// -----------------------------
// Processing logic
// -----------------------------
async function processCallEnded(data) {
  const {
    callId,
    workshopId,
    duration,
    cost,
    recording,
    transcript,
    structuredData,
    sentiment
  } = data;

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // 1) Update call
    await client.query(
      `UPDATE calls SET
        status = 'completed',
        ended_at = NOW(),
        duration_seconds = $1,
        cost_usd = $2,
        recording_url = $3,
        transcript = $4
      WHERE id = $5`,
      [duration || null, cost || 0, recording || null, transcript || null, callId]
    );

    // 2) Save analysis
    await client.query(
      `INSERT INTO call_analysis (
        call_id, structured_data, customer_name, customer_phone,
        vehicle_make, vehicle_model, issue_keywords, sentiment,
        booking_created
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (call_id) DO UPDATE SET
        structured_data = EXCLUDED.structured_data,
        customer_name = EXCLUDED.customer_name,
        customer_phone = EXCLUDED.customer_phone,
        vehicle_make = EXCLUDED.vehicle_make,
        vehicle_model = EXCLUDED.vehicle_model,
        issue_keywords = EXCLUDED.issue_keywords,
        sentiment = EXCLUDED.sentiment,
        booking_created = EXCLUDED.booking_created`,
      [
        callId,
        JSON.stringify(structuredData || {}),
        structuredData?.customer_name || null,
        structuredData?.customer_phone || null,
        structuredData?.vehicle_make || null,
        structuredData?.vehicle_model || null,
        structuredData?.issue_summary || null,
        sentiment?.label || 'neutral',
        Boolean(structuredData?.booking_confirmed)
      ]
    );

    // 3) Create booking if confirmed
    if (structuredData?.booking_confirmed && structuredData?.customer_name) {
      await createBookingFromStructuredData({ callId, workshopId, structuredData }, client);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function createBookingFromStructuredData({ callId, workshopId, structuredData }, client) {
  const customerPhone = structuredData.customer_phone;

  // customer
  const existingCustomer = await client.query(
    `SELECT id FROM customers WHERE workshop_id = $1 AND phone = $2`,
    [workshopId, customerPhone]
  );

  let customerId;
  if (existingCustomer.rows.length === 0) {
    const created = await client.query(
      `INSERT INTO customers (workshop_id, name, phone, email)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [workshopId, structuredData.customer_name, customerPhone, structuredData.customer_email || null]
    );
    customerId = created.rows[0].id;
  } else {
    customerId = existingCustomer.rows[0].id;
  }

  // vehicle
  let vehicleId = null;
  if (structuredData.vehicle_make && structuredData.vehicle_model) {
    const v = await client.query(
      `INSERT INTO vehicles (customer_id, make, model, year)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [customerId, structuredData.vehicle_make, structuredData.vehicle_model, structuredData.vehicle_year || null]
    );
    vehicleId = v.rows[0].id;
  }

  // scheduled_at fallback
  const scheduledAt = new Date();
  scheduledAt.setDate(scheduledAt.getDate() + 1);
  scheduledAt.setHours(10, 0, 0, 0);

  const booking = await client.query(
    `INSERT INTO bookings (
      workshop_id, customer_id, vehicle_id, call_id,
      scheduled_at, issue_summary, issue_category, urgency, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed')
    RETURNING id, scheduled_at`,
    [
      workshopId,
      customerId,
      vehicleId,
      callId,
      scheduledAt,
      structuredData.issue_summary || 'General service',
      structuredData.issue_category || 'other',
      structuredData.urgency || 'normal'
    ]
  );

  await client.query(
    `UPDATE call_analysis SET booking_created = true WHERE call_id = $1`,
    [callId]
  );

  // Notify booking service (best effort)
  try {
    await axios.post(`${process.env.BOOKING_SERVICE_URL}/api/bookings/notify`, {
      bookingId: booking.rows[0].id,
      workshopId,
      customerId,
      customerEmail: structuredData.customer_email || null,
      scheduledAt: booking.rows[0].scheduled_at
    }, { headers: { 'x-api-key': process.env.API_KEY } });
  } catch (e) {
    console.warn('⚠️ Booking notify failed:', e.message);
  }
}

module.exports = router;
