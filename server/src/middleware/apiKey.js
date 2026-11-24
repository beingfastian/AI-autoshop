// The voice agent's key: it sends VOICE_AGENT_KEY as "Authorization: Bearer <key>" to /api/voice.
// A separate key from the admin API_KEY, so a leak from the agent's host can't reach the staff API.
// Staff routes (sessions and the admin key) are handled in middleware/session.js.
const crypto = require('crypto');

function sameSecret(a, b) {
  // Hash first so lengths always match and the comparison takes constant time
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireVoiceAgentKey(req, res, next) {
  const expected = process.env.VOICE_AGENT_KEY;
  const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (!expected || !match || !sameSecret(match[1], expected)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

module.exports = { requireVoiceAgentKey };
