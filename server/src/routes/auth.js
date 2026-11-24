// Dashboard sign-in.
//   POST /api/auth/login   { email, password } -> sets the session cookie
//   POST /api/auth/logout                      -> ends the session
//   GET  /api/auth/me                          -> the signed-in user and their shop
const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../config/database');
const { login, logout, AuthError } = require('../services/auth');
const { requireStaff, sessionToken, setSessionCookie, clearSessionCookie } = require('../middleware/session');

const router = express.Router();

// Attempts per IP + email, on top of the per-account lock. Keyed with the email too because many
// visitors can share one IP behind proxies and office networks: one person's typos must not lock
// everyone else out. In-memory (per instance); the account lock in the DB holds everywhere.
const loginLimiter = rateLimit({
  keyGenerator: (req) => `${req.ip || 'unknown'}|${String(req.body?.email || '').trim().toLowerCase()}`,
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in a few minutes.' }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const session = await login(email, password, { userAgent: req.get('user-agent') });
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({ user: session.user });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(error.code === 'LOCKED' ? 429 : 401).json({ error: error.message });
    }
    next(error);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    await logout(sessionToken(req));
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireStaff, async (req, res, next) => {
  if (req.auth.kind !== 'user') return res.status(400).json({ error: 'The admin key has no user' });
  try {
    const { rows } = await query(
      'SELECT id, name, timezone, status, ai_phone_number FROM workshops WHERE id = $1',
      [req.auth.workshopId]
    );
    res.json({ user: req.auth.user, workshop: rows[0] || null });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
