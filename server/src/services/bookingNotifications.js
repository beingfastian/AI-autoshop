// Booking emails (customer confirmation + workshop notification), sent after the booking commits.
// Moved unchanged from routes/bookings.js so both the REST route and the call webhook can call it
// directly (they used to be separate services talking over HTTP). Replaced by queued jobs in step 1.7.
const { query } = require('../config/database');
const {
  sendBookingConfirmationCustomer,
  sendBookingNotificationWorkshop
} = require('../config/sendgrid');

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
      w.address as workshop_address,
      w.timezone as workshop_timezone
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

  // Format date and time in the shop's timezone, not the server's (servers usually run in UTC)
  const scheduledDate = new Date(booking.scheduled_at);
  const timeZone = booking.workshop_timezone;
  const formattedDate = scheduledDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone
  });
  const formattedTime = scheduledDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone
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

module.exports = { sendNotifications };
