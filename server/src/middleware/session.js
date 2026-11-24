// Who is making a staff request:
//   req.auth = { kind: 'user', user, workshopId } - shop staff signed in to the dashboard (cookie)
//   req.auth = { kind: 'admin' }                  - API_KEY holder (scripts, ops): every shop
// Routes use scopedWorkshopId(req) to restrict data to the user's own shop.
const crypto = require('crypto');
const { userForToken, SESSION_DAYS } = require('../services/auth');

const COOKIE = 'session';

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      const name = part.slice(0, i).trim();
      try {
        out[name] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        // ignore malformed cookie values
      }
    }
  }
  return out;
}

const sessionToken = (req) => parseCookies(req.get('cookie'))[COOKIE];

// httpOnly: page scripts can't read it. SameSite=Lax: other sites can't make the browser send it
// on POSTs. Secure in production: only over HTTPS.
function setSessionCookie(res, token, expiresAt) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000)) || SESSION_DAYS * 86400}`
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function isAdminKey(req) {
  const expected = process.env.API_KEY;
  const given = req.get('x-api-key');
  if (!expected || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Staff routes: a signed-in user (their shop only) or the admin API key. */
async function requireStaff(req, res, next) {
  try {
    if (isAdminKey(req)) {
      req.auth = { kind: 'admin' };
      return next();
    }
    const user = await userForToken(sessionToken(req));
    if (!user || !user.workshop_id) return res.status(401).json({ error: 'Please sign in' });
    req.auth = { kind: 'user', user, workshopId: user.workshop_id };
    next();
  } catch (error) {
    next(error);
  }
}

/** Only these roles may continue (admin key always may). */
const requireRole = (...roles) => (req, res, next) =>
  req.auth?.kind === 'admin' || roles.includes(req.auth?.user?.role)
    ? next()
    : res.status(403).json({ error: 'Your role cannot do this' });

/** The shop a request is limited to, or null for the admin key (all shops). */
const scopedWorkshopId = (req) => (req.auth?.kind === 'user' ? req.auth.workshopId : null);

module.exports = {
  requireStaff,
  requireRole,
  scopedWorkshopId,
  sessionToken,
  setSessionCookie,
  clearSessionCookie,
  parseCookies
};
