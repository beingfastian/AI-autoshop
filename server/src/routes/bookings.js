// Booking Routes - Complete CRUD operations
const express = require('express');
const router = express.Router();
const { query, getClient } = require('../config/database');
const { createBooking, BookingError, SchedulingError, ISSUE_CATEGORIES, URGENCIES } = require('../services/bookings');
const { getAvailableSlots, reserveSlot, ACTIVE_STATUSES } = require('../services/scheduling');
const { resetReminders } = require('../services/notifications');
const { requireUuidParam } = require('../utils/ids');

// Must match the bookings_status_check constraint (migration 0004)
const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];

router.param('id', requireUuidParam('Booking not found'));

/**
 * GET /api/bookings
 * List all bookings with filters
 */
router.get('/', async (req, res) => {
  try {
    const { 
      workshop_id,
      status,
      date_from,
      date_to,
      limit = 50,
      offset = 0
    } = req.query;
    
    let queryText = `
      SELECT 
        b.*,
        c.name as customer_name,
        c.phone as customer_phone,
        c.email as customer_email,
        v.make as vehicle_make,
        v.model as vehicle_model,
        v.year as vehicle_year,
        w.name as workshop_name,
        w.email as workshop_email
      FROM bookings b
      JOIN customers c ON c.id = b.customer_id
      LEFT JOIN vehicles v ON v.id = b.vehicle_id
      JOIN workshops w ON w.id = b.workshop_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 1;
    
    // Add filters
    if (workshop_id) {
      queryText += ` AND b.workshop_id = $${paramCount}`;
      params.push(workshop_id);
      paramCount++;
    }
    
    if (status) {
      queryText += ` AND b.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }
    
    if (date_from) {
      queryText += ` AND b.scheduled_at >= $${paramCount}`;
      params.push(date_from);
      paramCount++;
    }
    
    if (date_to) {
      queryText += ` AND b.scheduled_at <= $${paramCount}`;
      params.push(date_to);
      paramCount++;
    }
    
    queryText += ` ORDER BY b.scheduled_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);
    
    const result = await query(queryText, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM bookings WHERE 1=1';
    const countParams = [];
    let countParamCount = 1;
    
    if (workshop_id) {
      countQuery += ` AND workshop_id = $${countParamCount}`;
      countParams.push(workshop_id);
      countParamCount++;
    }
    
    if (status) {
      countQuery += ` AND status = $${countParamCount}`;
      countParams.push(status);
      countParamCount++;
    }
    
    const countResult = await query(countQuery, countParams);
    
    res.json({
      bookings: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/bookings/:id
 * Get single booking by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      `SELECT 
        b.*,
        c.name as customer_name,
        c.phone as customer_phone,
        c.email as customer_email,
        v.make as vehicle_make,
        v.model as vehicle_model,
        v.year as vehicle_year,
        v.variant as vehicle_variant,
        w.name as workshop_name,
        w.email as workshop_email,
        w.phone as workshop_phone,
        w.address as workshop_address,
        w.timezone as workshop_timezone,
        cl.duration_seconds as call_duration,
        an.sentiment
      FROM bookings b
      JOIN customers c ON c.id = b.customer_id
      LEFT JOIN vehicles v ON v.id = b.vehicle_id
      JOIN workshops w ON w.id = b.workshop_id
      LEFT JOIN calls cl ON cl.id = b.call_id
      LEFT JOIN call_analysis an ON an.call_id = b.call_id
      WHERE b.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    res.json(result.rows[0]);
    
  } catch (error) {
    console.error('Error fetching booking:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/bookings
 * Create a booking manually (staff or dashboard). Same rules as phone bookings:
 * 400 invalid input, 404 unknown workshop, 409 slot full or shop not taking bookings,
 * 422 time not bookable (past, closed, outside hours, too soon); 409/422 include alternatives.
 */
router.post('/', async (req, res) => {
  const body = req.body || {};
  const input = {
    workshopId: body.workshop_id,
    customer: { name: body.customer_name, phone: body.customer_phone, email: body.customer_email },
    vehicle: { make: body.vehicle_make, model: body.vehicle_model, year: body.vehicle_year },
    issue: { summary: body.issue_summary, category: body.issue_category, urgency: body.urgency },
    scheduledAt: body.scheduled_at,
    durationMinutes: body.duration_minutes
  };

  const client = await getClient();
  let result;
  try {
    await client.query('BEGIN');
    result = await createBooking(client, input);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    return sendBookingError(res, error, input);
  }
  client.release();

  // Confirmation messages were queued in the booking's transaction; the worker sends them

  res.status(201).json({
    success: true,
    booking: result.booking,
    message: 'Booking created successfully'
  });
});

async function sendBookingError(res, error, input) {
  if (error instanceof BookingError) {
    if (error.code === 'INVALID_INPUT') {
      return res.status(400).json({ error: 'Missing or invalid fields', details: error.details });
    }
    if (error.code === 'WORKSHOP_NOT_FOUND') return res.status(404).json({ error: error.message });
    return res.status(409).json({ error: error.message, code: error.code });
  }

  if (error instanceof SchedulingError) {
    let alternatives = [];
    try {
      const { rows } = await query('SELECT * FROM workshops WHERE id = $1', [input.workshopId]);
      const requested = new Date(input.scheduledAt);
      const from = Number.isNaN(requested.getTime()) || requested < new Date() ? undefined : requested;
      if (rows[0]) alternatives = await getAvailableSlots({ query }, rows[0], { from, limit: 3 });
    } catch (e) {
      console.error('Could not load alternative times:', e);
    }
    return res.status(error.code === 'SLOT_FULL' ? 409 : 422).json({
      error: error.message,
      code: error.code,
      alternatives: alternatives.map((s) => ({ start: s.start, local: s.local }))
    });
  }

  console.error('Error creating booking:', error);
  return res.status(500).json({ error: 'Failed to create booking' });
}

/**
 * PUT /api/bookings/:id
 * Update a booking. Moving it, or re-opening a cancelled one, goes through the same slot checks
 * as a new booking (hours, holidays, capacity) and resets its reminders for the new time.
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { scheduled_at, status, issue_summary, issue_category, urgency } = req.body || {};

  const problems = [];
  if (scheduled_at !== undefined && Number.isNaN(new Date(scheduled_at).getTime())) problems.push('scheduled_at must be a valid date and time');
  if (status !== undefined && !BOOKING_STATUSES.includes(status)) problems.push(`status must be one of: ${BOOKING_STATUSES.join(', ')}`);
  if (issue_summary !== undefined && (typeof issue_summary !== 'string' || !issue_summary.trim())) problems.push('issue_summary must not be empty');
  if (issue_category !== undefined && !ISSUE_CATEGORIES.includes(issue_category)) problems.push(`issue_category must be one of: ${ISSUE_CATEGORIES.join(', ')}`);
  if (urgency !== undefined && !URGENCIES.includes(urgency)) problems.push(`urgency must be one of: ${URGENCIES.join(', ')}`);
  if (problems.length) {
    return res.status(400).json({ error: problems.length === 1 ? problems[0] : 'Invalid fields', details: problems });
  }
  if ([scheduled_at, status, issue_summary, issue_category, urgency].every((v) => v === undefined)) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const client = await getClient();
  let workshopId = null;
  try {
    await client.query('BEGIN');
    const current = (await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }
    workshopId = current.workshop_id;

    const newStatus = status ?? current.status;
    const newTime = scheduled_at !== undefined ? new Date(scheduled_at) : current.scheduled_at;
    const timeChanged = newTime.getTime() !== new Date(current.scheduled_at).getTime();
    const willBeActive = ACTIVE_STATUSES.includes(newStatus);
    const reopening = willBeActive && !ACTIVE_STATUSES.includes(current.status);

    if (willBeActive && (timeChanged || reopening)) {
      const workshop = (await client.query('SELECT * FROM workshops WHERE id = $1', [current.workshop_id])).rows[0];
      await reserveSlot(client, workshop, newTime, {
        durationMinutes: current.duration_minutes ?? undefined,
        excludeBookingId: current.id
      });
    }

    const { rows } = await client.query(
      `UPDATE bookings SET
         scheduled_at = $2,
         status = $3::varchar,
         issue_summary = COALESCE($4, issue_summary),
         issue_category = COALESCE($5, issue_category),
         urgency = COALESCE($6, urgency),
         -- the DB requires a cancellation time; keep the first one, clear it when re-opened
         cancelled_at = CASE WHEN $3::varchar = 'cancelled' THEN COALESCE(cancelled_at, NOW()) ELSE NULL END,
         cancellation_reason = CASE WHEN $3::varchar = 'cancelled' THEN cancellation_reason ELSE NULL END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, newTime, newStatus, issue_summary?.trim() ?? null, issue_category ?? null, urgency ?? null]
    );
    if (timeChanged) await resetReminders(client, id);

    await client.query('COMMIT');
    res.json({ success: true, booking: rows[0], message: 'Booking updated successfully' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof SchedulingError) {
      return sendBookingError(res, error, { workshopId, scheduledAt: scheduled_at });
    }
    console.error('Error updating booking:', error);
    res.status(500).json({ error: 'Failed to update booking' });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/bookings/:id
 * Cancel booking
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const reason = typeof req.body?.cancellation_reason === 'string'
      ? req.body.cancellation_reason.trim().slice(0, 1000) || null
      : null;

    // Only open bookings can be cancelled; the status check also stops a repeat
    // request from overwriting the original cancellation time
    const result = await query(
      `UPDATE bookings
       SET status = 'cancelled',
           cancelled_at = NOW(),
           cancellation_reason = $2
       WHERE id = $1 AND status IN ('pending', 'confirmed')
       RETURNING *`,
      [id, reason]
    );

    if (result.rows.length === 0) {
      const existing = await query('SELECT * FROM bookings WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Booking not found' });
      }
      const booking = existing.rows[0];
      if (booking.status === 'cancelled') {
        return res.json({ success: true, booking, message: 'Booking was already cancelled' });
      }
      return res.status(409).json({ error: `A ${booking.status} booking cannot be cancelled` });
    }

    res.json({
      success: true,
      booking: result.rows[0],
      message: 'Booking cancelled successfully'
    });
    
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
});

module.exports = router;
