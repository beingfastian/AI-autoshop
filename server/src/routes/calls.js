// Call routes for staff: read call history. Live calls go through routes/voice.js.
const express = require('express');
const router = express.Router();
const { requireUuidParam, requireOwnRow, pageParams } = require('../utils/ids');
const { scopedWorkshopId } = require('../middleware/session');

const { query } = require('../config/database');

router.param('id', requireUuidParam('Call not found'));
router.param('id', requireOwnRow('calls', 'Call not found'));
router.param('workshopId', requireUuidParam('Workshop not found'));
// Staff can only list their own shop's calls
router.param('workshopId', (req, res, next, id) => {
  const own = scopedWorkshopId(req);
  return own && own !== id ? res.status(404).json({ error: 'Workshop not found' }) : next();
});

/**
 * GET /api/calls
 * The signed-in user's own shop's calls (same filters as /workshop/:workshopId)
 */
router.get('/', (req, res, next) => {
  const own = scopedWorkshopId(req);
  if (!own) return res.status(400).json({ error: 'Use /api/calls/workshop/:workshopId with the admin key' });
  req.params.workshopId = own;
  return listCalls(req, res, next);
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
        ca.sentiment,
        ca.customer_name,
        ca.customer_phone,
        ca.vehicle_make,
        ca.vehicle_model,
        ca.issue_keywords AS issue_summary,
        ca.booking_created,
        ca.callback_requested
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
router.get('/workshop/:workshopId', (req, res, next) => listCalls(req, res, next));

async function listCalls(req, res) {
  try {
    const { workshopId } = req.params;
    const { status } = req.query;
    const { limit, offset } = pageParams(req.query);
    
    // No transcript here: lists stay small; GET /api/calls/:id has the full call
    let queryText = `
      SELECT
        c.id, c.workshop_id, c.from_number, c.to_number, c.status, c.started_at, c.answered_at,
        c.ended_at, c.duration_seconds, c.ended_reason, c.cost_usd,
        ca.customer_name,
        ca.customer_phone,
        ca.vehicle_make,
        ca.vehicle_model,
        ca.issue_keywords AS issue_summary,
        ca.booking_created,
        ca.callback_requested
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
      limit,
      offset
    });
    
  } catch (error) {
    console.error('Error fetching calls:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = router;