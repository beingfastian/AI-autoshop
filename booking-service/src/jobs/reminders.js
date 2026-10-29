// Booking Routes - Complete CRUD operations
const express = require('express');
const router = express.Router();
const { query, getClient } = require('../config/database');
const { 
  sendBookingConfirmationCustomer, 
  sendBookingNotificationWorkshop 
} = require('../config/sendgrid');

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
        ca.id as call_id,
        ca.duration_seconds as call_duration,
        ca.sentiment
      FROM bookings b
      JOIN customers c ON c.id = b.customer_id
      LEFT JOIN vehicles v ON v.id = b.vehicle_id
      JOIN workshops w ON w.id = b.workshop_id
      LEFT JOIN calls ca ON ca.id = b.call_id
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
 * Create new booking manually
 */
router.post('/', async (req, res) => {
  const client = await getClient();
  
  try {
    const {
      workshop_id,
      customer_name,
      customer_phone,
      customer_email,
      vehicle_make,
      vehicle_model,
      vehicle_year,
      issue_summary,
      issue_category,
      urgency,
      scheduled_at
    } = req.body;
    
    // Validation
    if (!workshop_id || !customer_name || !customer_phone || !issue_summary || !scheduled_at) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['workshop_id', 'customer_name', 'customer_phone', 'issue_summary', 'scheduled_at']
      });
    }
    
    await client.query('BEGIN');
    
    // 1. Find or create customer
    let customerResult = await client.query(
      `SELECT id FROM customers WHERE workshop_id = $1 AND phone = $2`,
      [workshop_id, customer_phone]
    );
    
    let customer_id;
    
    if (customerResult.rows.length === 0) {
      const newCustomer = await client.query(
        `INSERT INTO customers (workshop_id, name, phone, email)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [workshop_id, customer_name, customer_phone, customer_email]
      );
      customer_id = newCustomer.rows[0].id;
    } else {
      customer_id = customerResult.rows[0].id;
    }
    
    // 2. Create vehicle if provided
    let vehicle_id = null;
    if (vehicle_make && vehicle_model) {
      const vehicleResult = await client.query(
        `INSERT INTO vehicles (customer_id, make, model, year)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [customer_id, vehicle_make, vehicle_model, vehicle_year]
      );
      vehicle_id = vehicleResult.rows[0].id;
    }
    
    // 3. Create booking
    const bookingResult = await client.query(
      `INSERT INTO bookings (
        workshop_id, customer_id, vehicle_id,
        scheduled_at, issue_summary, issue_category,
        urgency, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        workshop_id,
        customer_id,
        vehicle_id,
        scheduled_at,
        issue_summary,
        issue_category || 'other',
        urgency || 'normal',
        'confirmed'
      ]
    );
    
    const booking = bookingResult.rows[0];
    
    await client.query('COMMIT');
    
    // Send notifications in background
    setImmediate(async () => {
      try {
        await sendNotifications(booking.id);
      } catch (error) {
        console.error('Failed to send notifications:', error);
      }
    });
    
    res.status(201).json({
      success: true,
      booking,
      message: 'Booking created successfully'
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/bookings/:id
 * Update booking
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      scheduled_at,
      status,
      issue_summary,
      issue_category,
      urgency
    } = req.body;
    
    // Build update query dynamically
    const updates = [];
    const params = [];
    let paramCount = 1;
    
    if (scheduled_at !== undefined) {
      updates.push(`scheduled_at = $${paramCount}`);
      params.push(scheduled_at);
      paramCount++;
    }
    
    if (status !== undefined) {
      updates.push(`status = $${paramCount}`);
      params.push(status);
      paramCount++;
    }
    
    if (issue_summary !== undefined) {
      updates.push(`issue_summary = $${paramCount}`);
      params.push(issue_summary);
      paramCount++;
    }
    
    if (issue_category !== undefined) {
      updates.push(`issue_category = $${paramCount}`);
      params.push(issue_category);
      paramCount++;
    }
    
    if (urgency !== undefined) {
      updates.push(`urgency = $${paramCount}`);
      params.push(urgency);
      paramCount++;
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    params.push(id);
    
    const result = await query(
      `UPDATE bookings 
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramCount}
       RETURNING *`,
      params
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    res.json({
      success: true,
      booking: result.rows[0],
      message: 'Booking updated successfully'
    });
    
  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

/**
 * DELETE /api/bookings/:id
 * Cancel booking
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { cancellation_reason } = req.body;
    
    const result = await query(
      `UPDATE bookings 
       SET status = 'cancelled', 
           cancelled_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
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

/**
 * POST /api/bookings/notify
 * Send notification emails for a booking
 */
router.post('/notify', async (req, res) => {
  try {
    const { bookingId } = req.body;
    
    await sendNotifications(bookingId);
    
    res.json({
      success: true,
      message: 'Notifications sent successfully'
    });
    
  } catch (error) {
    console.error('Error sending notifications:', error);
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

/**
 * Helper: Send notifications for a booking
 */
async function sendNotifications(bookingId) {
  // Get booking details
  const result = await query(
    `SELECT 
      b.*,
      c.name as customer_name,
      c.phone as customer_phone,
      c.email as customer_email,
      v.make as vehicle_make,
      v.model as vehicle_model,
      v.year as vehicle_year,
      w.name as workshop_name,
      w.email as workshop_email,
      w.phone as workshop_phone,
      w.address as workshop_address
    FROM bookings b
    JOIN customers c ON c.id = b.customer_id
    LEFT JOIN vehicles v ON v.id = b.vehicle_id
    JOIN workshops w ON w.id = b.workshop_id
    WHERE b.id = $1`,
    [bookingId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Booking not found');
  }
  
  const booking = result.rows[0];
  
  // Format date and time
  const scheduledDate = new Date(booking.scheduled_at);
  const formattedDate = scheduledDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const formattedTime = scheduledDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  // Send customer confirmation email
  if (booking.customer_email && !booking.customer_email_sent) {
    try {
      await sendBookingConfirmationCustomer({
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        workshopName: booking.workshop_name,
        workshopAddress: booking.workshop_address,
        workshopPhone: booking.workshop_phone,
        scheduledDate: formattedDate,
        scheduledTime: formattedTime,
        vehicleMake: booking.vehicle_make || 'Your vehicle',
        vehicleModel: booking.vehicle_model || '',
        issueSummary: booking.issue_summary,
        bookingId: booking.id
      });
      
      await query(
        'UPDATE bookings SET customer_email_sent = true WHERE id = $1',
        [bookingId]
      );
      
      console.log(`✅ Customer email sent for booking ${bookingId}`);
    } catch (error) {
      console.error('Failed to send customer email:', error);
    }
  }
  
  // Send workshop notification email
  if (!booking.workshop_email_sent) {
    try {
      await sendBookingNotificationWorkshop({
        workshopEmail: booking.workshop_email,
        customerName: booking.customer_name,
        customerPhone: booking.customer_phone,
        customerEmail: booking.customer_email,
        scheduledDate: formattedDate,
        scheduledTime: formattedTime,
        vehicleMake: booking.vehicle_make || 'Unknown',
        vehicleModel: booking.vehicle_model || '',
        vehicleYear: booking.vehicle_year || '',
        issueSummary: booking.issue_summary,
        issueCategory: booking.issue_category,
        urgency: booking.urgency,
        bookingId: booking.id,
        dashboardUrl: process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000'
      });
      
      await query(
        'UPDATE bookings SET workshop_email_sent = true WHERE id = $1',
        [bookingId]
      );
      
      console.log(`✅ Workshop email sent for booking ${bookingId}`);
    } catch (error) {
      console.error('Failed to send workshop email:', error);
    }
  }
}

module.exports = router;