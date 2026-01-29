// Call Routes - Handle incoming calls and call management
const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const axios = require('axios');

// Vapi SDK would be imported here
// const { VapiClient } = require('@vapi-ai/server-sdk');
// const vapi = new VapiClient({ token: process.env.VAPI_API_KEY });

/**
 * POST /api/calls/inbound
 * Handle incoming call from Twilio/Vapi
 */
router.post('/inbound', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { 
      from: fromNumber, 
      to: toNumber,
      callSid 
    } = req.body;
    
    console.log(`📞 Incoming call from ${fromNumber} to ${toNumber}`);
    
    // 1. Find workshop by phone number
    const workshopResult = await query(
      `SELECT w.* FROM workshops w 
       WHERE w.vapi_phone_number = $1 AND w.status = 'active'`,
      [toNumber]
    );
    
    if (workshopResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Workshop not found',
        message: 'No active workshop found for this phone number'
      });
    }
    
    const workshop = workshopResult.rows[0];
    
    // 2. Create call record
    const callResult = await query(
      `INSERT INTO calls (
        workshop_id, from_number, to_number, 
        vapi_call_id, status, started_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *`,
      [
        workshop.id,
        fromNumber,
        toNumber,
        callSid,
        'initiated'
      ]
    );
    
    const call = callResult.rows[0];
    
    // 3. Build Vapi assistant configuration
    const vapiConfig = {
      assistant: {
        firstMessage: `Thank you for calling ${workshop.name}. I'm your AI assistant and I can help you book an appointment. May I have your name please?`,
        
        model: {
          provider: 'openai',
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: buildSystemPrompt(workshop)
            }
          ],
          temperature: 0.7
        },
        
        voice: {
          provider: 'elevenlabs',
          voiceId: 'rachel'
        },
        
        // Structured data extraction
        analysisPlan: {
          structuredDataSchema: {
            type: 'object',
            properties: {
              customer_name: { type: 'string' },
              customer_phone: { type: 'string' },
              customer_email: { type: 'string' },
              vehicle_make: { type: 'string' },
              vehicle_model: { type: 'string' },
              vehicle_year: { type: 'number' },
              issue_summary: { type: 'string' },
              issue_category: { 
                type: 'string',
                enum: ['brakes', 'engine', 'transmission', 'electrical', 'tires', 'other']
              },
              urgency: {
                type: 'string',
                enum: ['urgent', 'normal', 'low']
              },
              preferred_date: { type: 'string' },
              preferred_time: { type: 'string' },
              booking_confirmed: { type: 'boolean' }
            },
            required: ['customer_name', 'customer_phone', 'issue_summary']
          }
        }
      },
      
      // Webhook configuration
      serverUrl: `${process.env.API_BASE_URL}/api/webhooks/vapi/call-ended`,
      serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET,
      
      // Metadata
      metadata: {
        call_id: call.id,
        workshop_id: workshop.id
      }
    };
    
    // 4. In production, you would create the Vapi call here
    // const vapiCall = await vapi.calls.create(vapiConfig);
    
    // For now, simulate response
    console.log(`✅ Call initiated: ${call.id} (${Date.now() - startTime}ms)`);
    
    res.status(200).json({
      success: true,
      call_id: call.id,
      workshop_name: workshop.name,
      status: 'initiated',
      message: 'Call connected to AI assistant'
    });
    
  } catch (error) {
    console.error('❌ Error handling inbound call:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Unable to process call'
    });
  }
});

/**
 * GET /api/calls/:id
 * Get call details by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      `SELECT 
        c.*,
        w.name as workshop_name,
        ca.structured_data,
        ca.sentiment
      FROM calls c
      JOIN workshops w ON w.id = c.workshop_id
      LEFT JOIN call_analysis ca ON ca.call_id = c.id
      WHERE c.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    res.json(result.rows[0]);
    
  } catch (error) {
    console.error('Error fetching call:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/calls/workshop/:workshopId
 * Get all calls for a workshop
 */
router.get('/workshop/:workshopId', async (req, res) => {
  try {
    const { workshopId } = req.params;
    const { limit = 50, offset = 0, status } = req.query;
    
    let queryText = `
      SELECT 
        c.*,
        ca.customer_name,
        ca.vehicle_make,
        ca.vehicle_model,
        ca.booking_created
      FROM calls c
      LEFT JOIN call_analysis ca ON ca.call_id = c.id
      WHERE c.workshop_id = $1
    `;
    
    const params = [workshopId];
    
    // Filter by status if provided
    if (status) {
      queryText += ` AND c.status = $${params.length + 1}`;
      params.push(status);
    }
    
    queryText += ` ORDER BY c.started_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    const result = await query(queryText, params);
    
    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM calls WHERE workshop_id = $1`,
      [workshopId]
    );
    
    res.json({
      calls: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
  } catch (error) {
    console.error('Error fetching calls:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Build system prompt for AI assistant
 */
function buildSystemPrompt(workshop) {
  const businessHours = JSON.stringify(workshop.business_hours, null, 2);
  
  return `You are a professional receptionist for ${workshop.name}, an auto repair workshop.

Your job is to:
1. Greet the customer warmly
2. Collect their name, phone number, and email (if they want confirmation)
3. Ask about their vehicle (make, model, year)
4. Understand the issue they're experiencing
5. Determine urgency (urgent if safety-related or car won't start)
6. Offer to book an appointment
7. Get their preferred date and time
8. Confirm the booking details

Important guidelines:
- Be friendly, professional, and patient
- If customer doesn't know vehicle year or variant, that's okay - skip it
- Never quote prices - say "We'll provide an estimate after inspection"
- If issue is urgent (brakes not working, car won't start), prioritize and mention immediate availability
- Always confirm booking details before finalizing
- If customer wants to speak to a human, offer callback

Business hours:
${businessHours}

After collecting all information, confirm:
"Let me confirm: I have [NAME] with a [MAKE] [MODEL], [ISSUE], scheduled for [DATE] at [TIME]. Is that correct?"

Then say: "Perfect! You'll receive a confirmation email shortly. We look forward to seeing you!"`;
}

module.exports = router;