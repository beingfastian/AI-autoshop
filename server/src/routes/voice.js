// Voice agent API (provider-neutral). The agent (LiveKit today) calls these during a phone call.
// Auth: "Authorization: Bearer <VOICE_AGENT_KEY>" (see middleware/apiKey.js).
//
//   POST /api/voice/calls                       a call is ringing: answer / transfer / reject
//   POST /api/voice/calls/:callId/answered      the agent picked up
//   POST /api/voice/calls/:callId/availability  tool: check_availability
//   POST /api/voice/calls/:callId/bookings      tool: book_appointment
//   POST /api/voice/calls/:callId/end           end-of-call report
//
// Tool endpoints answer 200 with something the agent can say, even when the caller can't have
// what they asked for (booked: false + alternatives); 4xx/5xx mean a bug or outage, not a "no".
const express = require('express');
const voice = require('../services/voiceCalls');
const { requireUuidParam } = require('../utils/ids');

const router = express.Router();
router.param('callId', requireUuidParam('Call not found'));

// Wraps a handler: unknown call -> 404, anything unexpected -> logged 500 without internals
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error instanceof voice.CallNotFoundError) return res.status(404).json({ error: 'Call not found' });
    console.error(`Voice API ${req.method} ${req.path} failed:`, error);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

router.post('/calls', handle(async (req, res) => {
  const { provider_call_id: providerCallId, to_number: toNumber, from_number: fromNumber } = req.body || {};
  if (!providerCallId || !toNumber) {
    return res.status(400).json({ error: 'provider_call_id and to_number are required' });
  }
  res.json(await voice.startCall({ providerCallId, toNumber, fromNumber }));
}));

router.post('/calls/:callId/answered', handle(async (req, res) => {
  await voice.markAnswered(req.params.callId);
  res.json({ ok: true });
}));

router.post('/calls/:callId/availability', handle(async (req, res) => {
  res.json(await voice.findAvailability(req.params.callId, req.body || {}));
}));

router.post('/calls/:callId/bookings', handle(async (req, res) => {
  res.json(await voice.bookFromCall(req.params.callId, req.body || {}));
}));

router.post('/calls/:callId/end', handle(async (req, res) => {
  res.json({ ok: true, ...(await voice.recordCallEnd(req.params.callId, req.body || {})) });
}));

module.exports = router;
