// SendGrid email configuration
const sgMail = require('@sendgrid/mail');
const { safeHtml } = require('../utils/safeHtml');
require('dotenv').config();

// Initialize SendGrid with API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Send email using SendGrid
 * @param {Object} emailData - Email configuration
 * @returns {Promise}
 */
async function sendEmail(emailData) {
  const {
    to,
    from,
    subject,
    text,
    html,
    templateId,
    dynamicTemplateData,
    attachments
  } = emailData;
  
  const msg = {
    to,
    from: from || {
      email: process.env.SENDGRID_FROM_EMAIL,
      name: process.env.SENDGRID_FROM_NAME || 'AI Receptionist'
    },
    subject,
    text,
    html: html === undefined ? undefined : String(html), // safeHtml templates are objects

    // If using SendGrid dynamic templates
    ...(templateId && {
      templateId,
      dynamicTemplateData
    }),
    
    // Attachments (optional)
    ...(attachments && { attachments }),
    
    // Tracking settings
    trackingSettings: {
      clickTracking: { enable: true, enableText: false },
      openTracking: { enable: true },
      subscriptionTracking: { enable: false }
    }
  };
  
  try {
    const response = await sgMail.send(msg);
    console.log(`✅ Email sent to ${to}`);
    return response;
  } catch (error) {
    console.error('❌ SendGrid error:', error);
    
    if (error.response) {
      console.error('SendGrid response:', error.response.body);
    }
    
    throw error;
  }
}

/**
 * Send booking confirmation to customer
 */
async function sendBookingConfirmationCustomer(bookingData) {
  const {
    customerEmail,
    customerName,
    workshopName,
    workshopAddress,
    workshopPhone,
    scheduledDate,
    scheduledTime,
    vehicleMake,
    vehicleModel,
    issueSummary,
    bookingId
  } = bookingData;
  
  const subject = `Appointment Confirmed - ${workshopName}`;
  
  const html = safeHtml`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4CAF50; color: white; padding: 20px; text-align: center; }
        .content { background: #f9f9f9; padding: 20px; margin: 20px 0; }
        .detail-row { margin: 10px 0; }
        .label { font-weight: bold; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        .button { 
          background: #4CAF50; 
          color: white; 
          padding: 12px 24px; 
          text-decoration: none; 
          border-radius: 4px; 
          display: inline-block;
          margin: 20px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Appointment Confirmed</h1>
        </div>
        
        <div class="content">
          <p>Hi ${customerName},</p>
          
          <p>Your appointment has been confirmed! Here are the details:</p>
          
          <div class="detail-row">
            <span class="label">📅 Date & Time:</span> ${scheduledDate} at ${scheduledTime}
          </div>
          
          <div class="detail-row">
            <span class="label">🚗 Vehicle:</span> ${vehicleMake} ${vehicleModel}
          </div>
          
          <div class="detail-row">
            <span class="label">🔧 Issue:</span> ${issueSummary}
          </div>
          
          <div class="detail-row">
            <span class="label">📍 Location:</span> ${workshopName}<br/>
            ${workshopAddress}
          </div>
          
          <div class="detail-row">
            <span class="label">📞 Contact:</span> ${workshopPhone}
          </div>
          
          <p style="margin-top: 20px;">
            <strong>Booking Reference:</strong> #${bookingId.substring(0, 8).toUpperCase()}
          </p>
          
          <p>We look forward to seeing you!</p>
        </div>
        
        <div class="footer">
          <p>This is an automated confirmation email. Please do not reply.</p>
          <p>If you need to reschedule, please call us at ${workshopPhone}</p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  const text = `
Appointment Confirmed

Hi ${customerName},

Your appointment has been confirmed!

Date & Time: ${scheduledDate} at ${scheduledTime}
Vehicle: ${vehicleMake} ${vehicleModel}
Issue: ${issueSummary}
Location: ${workshopName}, ${workshopAddress}
Contact: ${workshopPhone}

Booking Reference: #${bookingId.substring(0, 8).toUpperCase()}

We look forward to seeing you!
  `;
  
  return sendEmail({
    to: customerEmail,
    subject,
    text,
    html
  });
}

/**
 * Send booking notification to workshop
 */
async function sendBookingNotificationWorkshop(bookingData) {
  const {
    workshopEmail,
    customerName,
    customerPhone,
    customerEmail,
    scheduledDate,
    scheduledTime,
    vehicleMake,
    vehicleModel,
    vehicleYear,
    issueSummary,
    issueCategory,
    urgency,
    bookingId,
    dashboardUrl
  } = bookingData;
  
  const urgencyColor = urgency === 'urgent' ? '#f44336' : '#4CAF50';
  const subject = `${urgency === 'urgent' ? '🚨 URGENT - ' : ''}New Booking: ${customerName} - ${scheduledDate}`;
  
  const html = safeHtml`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: ${urgencyColor}; color: white; padding: 20px; text-align: center; }
        .content { background: #f9f9f9; padding: 20px; margin: 20px 0; }
        .detail-row { margin: 10px 0; padding: 10px; background: white; border-left: 3px solid #4CAF50; }
        .label { font-weight: bold; color: #555; }
        .urgent { background: #ffebee; border-left-color: #f44336; }
        .button { 
          background: #2196F3; 
          color: white; 
          padding: 12px 24px; 
          text-decoration: none; 
          border-radius: 4px; 
          display: inline-block;
          margin: 20px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${urgency === 'urgent' ? '🚨 URGENT BOOKING' : '📅 New Booking'}</h1>
        </div>
        
        <div class="content">
          <h2>Customer Information</h2>
          
          <div class="detail-row">
            <span class="label">👤 Name:</span> ${customerName}
          </div>
          
          <div class="detail-row">
            <span class="label">📞 Phone:</span> ${customerPhone}
          </div>
          
          <div class="detail-row">
            <span class="label">📧 Email:</span> ${customerEmail || 'Not provided'}
          </div>
          
          <h2>Appointment Details</h2>
          
          <div class="detail-row ${urgency === 'urgent' ? 'urgent' : ''}">
            <span class="label">📅 Scheduled:</span> ${scheduledDate} at ${scheduledTime}
          </div>
          
          <div class="detail-row">
            <span class="label">🚗 Vehicle:</span> ${vehicleMake} ${vehicleModel} ${vehicleYear || ''}
          </div>
          
          <div class="detail-row ${urgency === 'urgent' ? 'urgent' : ''}">
            <span class="label">🔧 Issue:</span> ${issueSummary}
          </div>
          
          <div class="detail-row">
            <span class="label">📋 Category:</span> ${issueCategory}
          </div>
          
          ${urgency === 'urgent' ? safeHtml`
          <div class="detail-row urgent">
            <span class="label">⚠️ Priority:</span> <strong>URGENT - ${issueSummary.includes('brake') ? 'Safety Issue' : 'Immediate Attention Required'}</strong>
          </div>
          ` : ''}
          
          <div class="detail-row">
            <span class="label">🆔 Booking ID:</span> ${bookingId}
          </div>
          
          <a href="${dashboardUrl}/bookings/${bookingId}" class="button">
            View in Dashboard
          </a>
        </div>
        
        <div style="text-align: center; color: #666; font-size: 12px; margin-top: 20px;">
          <p>Customer confirmation email has been sent automatically.</p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  const text = `
${urgency === 'urgent' ? '🚨 URGENT BOOKING' : 'New Booking'}

Customer: ${customerName}
Phone: ${customerPhone}
Email: ${customerEmail || 'Not provided'}

Scheduled: ${scheduledDate} at ${scheduledTime}
Vehicle: ${vehicleMake} ${vehicleModel} ${vehicleYear || ''}
Issue: ${issueSummary}
Category: ${issueCategory}

${urgency === 'urgent' ? 'Priority: URGENT - Immediate attention required' : ''}

Booking ID: ${bookingId}
View in dashboard: ${dashboardUrl}/bookings/${bookingId}
  `;
  
  return sendEmail({
    to: workshopEmail,
    subject,
    text,
    html,
    // Set high priority for urgent bookings
    ...(urgency === 'urgent' && {
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'high'
      }
    })
  });
}

/**
 * Send booking reminder
 */
async function sendBookingReminder(bookingData) {
  const {
    customerEmail,
    customerName,
    workshopName,
    workshopPhone,
    scheduledDate,
    scheduledTime,
    vehicleMake,
    vehicleModel,
    hoursUntil
  } = bookingData;
  
  const subject = `Reminder: Your appointment ${hoursUntil === 24 ? 'tomorrow' : 'in 2 hours'} at ${workshopName}`;
  
  const html = safeHtml`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2196F3; color: white; padding: 20px; text-align: center; }
        .content { background: #f9f9f9; padding: 20px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔔 Appointment Reminder</h1>
        </div>
        
        <div class="content">
          <p>Hi ${customerName},</p>
          
          <p><strong>This is a reminder that you have an appointment ${hoursUntil === 24 ? 'tomorrow' : 'in 2 hours'}:</strong></p>
          
          <p>
            📅 <strong>${scheduledDate} at ${scheduledTime}</strong><br/>
            🚗 ${vehicleMake} ${vehicleModel}<br/>
            📍 ${workshopName}<br/>
            📞 ${workshopPhone}
          </p>
          
          <p>We look forward to seeing you!</p>
          
          <p style="font-size: 12px; color: #666; margin-top: 20px;">
            If you need to reschedule, please call us as soon as possible.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  return sendEmail({
    to: customerEmail,
    subject,
    html
  });
}

/**
 * Alert the shop that a caller needs a call back (the AI could not book them)
 */
async function sendCallbackRequest(data) {
  const { workshopEmail, workshopName, customerName, customerPhone, callTime, issueSummary, summary } = data;

  const subject = `Call back needed: ${customerName} (${customerPhone})`;

  const html = safeHtml`
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #FF9800; color: white; padding: 20px; text-align: center;">
          <h1>📞 Call back needed</h1>
        </div>
        <div style="background: #f9f9f9; padding: 20px; margin: 20px 0;">
          <p>A caller to ${workshopName} wanted an appointment, but the AI receptionist could not book one.</p>
          <p><strong>Name:</strong> ${customerName}<br/>
             <strong>Phone:</strong> <a href="tel:${customerPhone}">${customerPhone}</a><br/>
             <strong>Called:</strong> ${callTime}</p>
          <p><strong>Problem:</strong> ${issueSummary || 'Not captured'}</p>
          <p><strong>Call summary:</strong> ${summary || 'Not available'}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Call back needed

A caller to ${workshopName} wanted an appointment, but the AI receptionist could not book one.

Name: ${customerName}
Phone: ${customerPhone}
Called: ${callTime}
Problem: ${issueSummary || 'Not captured'}
Call summary: ${summary || 'Not available'}
  `;

  return sendEmail({ to: workshopEmail, subject, text, html });
}

module.exports = {
  sendEmail,
  sendBookingConfirmationCustomer,
  sendBookingNotificationWorkshop,
  sendBookingReminder,
  sendCallbackRequest
};