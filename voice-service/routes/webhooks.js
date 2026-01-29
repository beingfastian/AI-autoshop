// Webhook Routes - Handle callbacks from Vapi
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { query, getClient } = require('../config/database');
const axios = require('axios');

/**
 * Verify Vapi webhook signature
 */
function verifyVapiSignature(req) {
  const signature = req.headers['x-vapi-signature'];
  const timestamp = req.headers['x-vapi-timestamp'];
  
  if (!signature || !timestamp) {
    throw new Error('Missing signature or timestamp');
  }
  
  // Check timestamp (prevent replay attacks)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) { // 5 minutes
    throw new Error('Webhook timestamp too old');
  }
  
  // Verify signature
  const payload = timestamp + '.' + JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', process.env.VAPI_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  
  if (signature !== expectedSignature) {
    throw new Error('Invalid signature');
  }
  
  return true;
}

/**
 * POST /api/webhooks/vapi/call-started
 * Called when Vapi call starts
 */
router.post('/vapi/call-started', async (req, res) => {
  try {
    // Verify signature in production
    if (process.env.NODE_ENV === 'production') {
      verifyVapiSignature(req);
    }
    
    const { call, metadata } = req.body;
    const callId = metadata.call_id;
    
    // Update call status
    await query(
      `UPDATE calls SET status = 'in-progress', answered_at = NOW() WHERE id = $1`,
      [callId]
    );
    
    console.log(`📞 Call started: ${callId}`);
    
    // Return 200 immediately
    res.status(200).json({ received: true });
    
  } catch (error) {
    console.error('Webhook error:', error);
    // Still return 200 to prevent retries
    res.status(200).json({ received: true, error: error.message });
  }
});

/**
 * POST /api/webhooks/vapi/call-ended
 * Called when Vapi call ends - MOST IMPORTANT WEBHOOK
 */
router.post('/vapi/call-ended', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Verify signature in production
    if (process.env.NODE_ENV === 'production') {
      verifyVapiSignature(req);
    }
    
    const { call, analysis, metadata } = req.body;
    const callId = metadata.call_id;
    const workshopId = metadata.workshop_id;
    
    console.log(`📞 Call ended: ${callId}`);
    
    // Return 200 OK immediately (Vapi requires fast response)
    res.status(200).json({ received: true });
    
    // Process call asynchronously
    await processCallEnded({
      callId,
      workshopId,
      vapiCallId: call.id,
      duration: call.duration,
      cost: call.cost || 0,
      endReason: call.endedReason,
      recording: call.recordingUrl,
      transcript: call.transcript,
      structuredData: analysis?.structuredData || {},
      sentiment: analysis?.sentiment
    });
    
    const duration = Date.now() - startTime;
    console.log(`✅ Webhook processed in ${duration}ms`);
    
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    // Still return 200 to prevent Vapi retries
    res.status(200).json({ received: true, error: error.message });
  }
});

/**
 * Process call ended event (async processing)
 */
async function processCallEnded(data) {
  const {
    callId,
    workshopId,
    vapiCallId,
    duration,
    cost,
    endReason,
    recording,
    transcript,
    structuredData,
    sentiment
  } = data;
  
  const client = await getClient();
  
  try {
    // Start transaction
    await client.query('BEGIN');
    
    // 1. Update call record
    await client.query(
      `UPDATE calls SET
        status = $1,
        ended_at = NOW(),
        duration_seconds = $2,
        cost_usd = $3,
        recording_url = $4,
        transcript = $5
      WHERE id = $6`,
      ['completed', duration, cost, recording, transcript, callId]
    );
    
    // 2. Save call analysis
    await client.query(
      `INSERT INTO call_analysis (
        call_id, structured_data, customer_name, customer_phone,
        vehicle_make, vehicle_model, issue_keywords, sentiment,
        booking_created
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        callId,
        JSON.stringify(structuredData),
        structuredData.customer_name,
        structuredData.customer_phone,
        structuredData.vehicle_make,
        structuredData.vehicle_model,
        structuredData.issue_summary,
        sentiment?.label || 'neutral',
        structuredData.booking_confirmed || false
      ]
    );
    
    // 3. If booking was confirmed, create booking
    if (structuredData.booking_confirmed && structuredData.customer_name) {
      console.log(`📅 Creating booking for call ${callId}`);
      
      const bookingData = {
        callId,
        workshopId,
        customerName: structuredData.customer_name,
        customerPhone: structuredData.customer_phone,
        customerEmail: structuredData.customer_email,
        vehicleMake: structuredData.vehicle_make,
        vehicleModel: structuredData.vehicle_model,
        vehicleYear: structuredData.vehicle_year,
        issueSummary: structuredData.issue_summary,
        issueCategory: structuredData.issue_category || 'other',
        urgency: structuredData.urgency || 'normal',
        preferredDate: structuredData.preferred_date,
        preferredTime: structuredData.preferred_time
      };
      
      // Call booking service
      await createBooking(bookingData, client);
    }
    
    // Commit transaction
    await client.query('COMMIT');
    
    console.log(`✅ Call processed successfully: ${callId}`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error processing call:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Create booking from call data
 */
async function createBooking(data, client) {
  const {
    callId,
    workshopId,
    customerName,
    customerPhone,
    customerEmail,
    vehicleMake,
    vehicleModel,
    vehicleYear,
    issueSummary,
    issueCategory,
    urgency,
    preferredDate,
    preferredTime
  } = data;
  
  try {
    // 1. Find or create customer
    let customerResult = await client.query(
      `SELECT * FROM customers WHERE workshop_id = $1 AND phone = $2`,
      [workshopId, customerPhone]
    );
    
    let customerId;
    
    if (customerResult.rows.length === 0) {
      // Create new customer
      const newCustomer = await client.query(
        `INSERT INTO customers (workshop_id, name, phone, email)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [workshopId, customerName, customerPhone, customerEmail]
      );
      customerId = newCustomer.rows[0].id;
      console.log(`✅ Created new customer: ${customerId}`);
    } else {
      customerId = customerResult.rows[0].id;
    }
    
    // 2. Create vehicle if provided
    let vehicleId = null;
    if (vehicleMake && vehicleModel) {
      const vehicleResult = await client.query(
        `INSERT INTO vehicles (customer_id, make, model, year)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [customerId, vehicleMake, vehicleModel, vehicleYear]
      );
      vehicleId = vehicleResult.rows[0].id;
      console.log(`✅ Created vehicle: ${vehicleId}`);
    }
    
    // 3. Parse scheduled datetime
    const scheduledAt = parseDateTime(preferredDate, preferredTime);
    
    // 4. Create booking
    const bookingResult = await client.query(
      `INSERT INTO bookings (
        workshop_id, customer_id, vehicle_id, call_id,
        scheduled_at, issue_summary, issue_category, urgency, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        workshopId,
        customerId,
        vehicleId,
        callId,
        scheduledAt,
        issueSummary,
        issueCategory,
        urgency,
        'confirmed'
      ]
    );
    
    const booking = bookingResult.rows[0];
    console.log(`✅ Created booking: ${booking.id}`);
    
    // 5. Update call_analysis to mark booking created
    await client.query(
      `UPDATE call_analysis SET booking_created = true WHERE call_id = $1`,
      [callId]
    );
    
    // 6. Send to booking service for email notifications
    // In production, this would be an HTTP call or message queue
    try {
      await axios.post(`${process.env.BOOKING_SERVICE_URL}/api/bookings/notify`, {
        bookingId: booking.id,
        workshopId,
        customerId,
        customerEmail,
        scheduledAt
      });
    } catch (error) {
      console.warn('⚠️  Failed to notify booking service:', error.message);
      // Don't fail the transaction if notification fails
    }
    
    return booking;
    
  } catch (error) {
    console.error('Error creating booking:', error);
    throw error;
  }
}

/**
 * Parse date and time into timestamp
 */
function parseDateTime(date, time) {
  if (!date) {
    // Default to tomorrow at 10 AM
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    return tomorrow;
  }
  
  try {
    // Parse date (e.g., "2025-01-30" or "tomorrow" or "Monday")
    let targetDate = new Date();
    
    if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // ISO format
      targetDate = new Date(date);
    } else if (date.toLowerCase() === 'tomorrow') {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (date.toLowerCase() === 'today') {
      // today
    } else {
      // Try to parse as day of week or relative date
      targetDate.setDate(targetDate.getDate() + 1); // Default to tomorrow
    }
    
    // Parse time (e.g., "10:00 AM" or "14:00")
    let hour = 10;
    let minute = 0;
    
    if (time) {
      const timeMatch = time.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
      if (timeMatch) {
        hour = parseInt(timeMatch[1]);
        minute = parseInt(timeMatch[2]);
        
        if (timeMatch[3] && timeMatch[3].toLowerCase() === 'pm' && hour < 12) {
          hour += 12;
        }
        if (timeMatch[3] && timeMatch[3].toLowerCase() === 'am' && hour === 12) {
          hour = 0;
        }
      }
    }
    
    targetDate.setHours(hour, minute, 0, 0);
    return targetDate;
    
  } catch (error) {
    console.error('Error parsing date/time:', error);
    // Return tomorrow 10 AM as fallback
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    return tomorrow;
  }
}

module.exports = router;