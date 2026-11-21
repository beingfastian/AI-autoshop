// Interim protection for internal API routes until real accounts exist (Phase 2):
// callers must send the shared key in the x-api-key header
const crypto = require('crypto');

function sameSecret(a, b) {
  // Hash first so lengths always match and the comparison takes constant time
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireApiKey(req, res, next) {
  const expected = process.env.API_KEY;
  const given = req.get('x-api-key');
  if (!expected || !given || !sameSecret(given, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireApiKey };
