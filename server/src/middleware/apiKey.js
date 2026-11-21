// Shared-secret checks until real accounts exist (Phase 2):
// - requireApiKey: staff/dashboard callers send API_KEY in the x-api-key header
// - requireVoiceAgentKey: the voice agent sends VOICE_AGENT_KEY as "Authorization: Bearer <key>".
//   A separate key, so a leak from the agent's host can't reach the full customer/booking API.
const crypto = require('crypto');

function sameSecret(a, b) {
  // Hash first so lengths always match and the comparison takes constant time
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const unauthorized = (res) => res.status(401).json({ error: 'Unauthorized' });

function requireApiKey(req, res, next) {
  const expected = process.env.API_KEY;
  const given = req.get('x-api-key');
  if (!expected || !given || !sameSecret(given, expected)) return unauthorized(res);
  next();
}

function requireVoiceAgentKey(req, res, next) {
  const expected = process.env.VOICE_AGENT_KEY;
  const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (!expected || !match || !sameSecret(match[1], expected)) return unauthorized(res);
  next();
}

module.exports = { requireApiKey, requireVoiceAgentKey };
