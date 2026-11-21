// Call routes for staff: read call history. Live calls go through routes/voice.js.
const express = require('express');
const router = express.Router();
const { requireUuidParam } = require('../utils/ids');

const { query } = require('../config/database');

router.param('id', requireUuidParam('Call not found'));
router.param('workshopId', requireUuidParam('Workshop not found'));

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

module.exports = router;