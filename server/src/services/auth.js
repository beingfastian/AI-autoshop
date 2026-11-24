// Staff accounts and login sessions for the dashboard.
//
// - Passwords: scrypt (Node's built-in, deliberately slow; no native add-on, which matters on
//   serverless hosts) with a random salt per password. Stored as "scrypt$N$r$p$salt$hash".
// - Sessions: a random 32-byte token goes in an httpOnly cookie; only its SHA-256 is stored, so a
//   database leak can't be replayed as a login. Fixed 14-day lifetime; logout deletes the row.
// - Brute force: 5 wrong passwords lock the account for 15 minutes, tracked in the DB so the lock
//   holds across server instances. Unknown emails take the same time as wrong passwords, so
//   response times don't reveal which emails have accounts.
const crypto = require('crypto');
const { promisify } = require('util');
const { query } = require('../config/database');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 14;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const MIN_PASSWORD_LENGTH = 10;

class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError('WEAK_PASSWORD', `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

// false for a wrong password and for anything that isn't one of our hashes (e.g. a placeholder)
async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt' || typeof password !== 'string') return false;
  const [, N, r, p, salt, expected] = parts;
  const want = Buffer.from(expected, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(p) });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Computed once so unknown-email logins cost the same as real ones
let dummyHash;
const getDummyHash = async () => (dummyHash ??= await hashPassword(crypto.randomBytes(18).toString('base64')));

/**
 * Checks email + password and opens a session.
 * @returns { token, expiresAt, user } - token goes in the cookie, never in the DB
 * @throws AuthError INVALID_CREDENTIALS (same for unknown email, wrong password, disabled user) or LOCKED
 */
async function login(email, password, { userAgent } = {}) {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = $1', [normalized]);
  const user = rows[0];

  if (!user) {
    await verifyPassword(String(password), await getDummyHash());
    throw new AuthError('INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AuthError('LOCKED', `Too many failed attempts. Try again after ${LOCK_MINUTES} minutes.`);
  }

  const ok = await verifyPassword(String(password), user.password_hash);
  if (!ok || user.status !== 'active') {
    if (!ok) {
      await query(
        `UPDATE users SET
           failed_login_count = failed_login_count + 1,
           locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN NOW() + make_interval(mins => $3) ELSE locked_until END
         WHERE id = $1`,
        [user.id, MAX_FAILED_LOGINS, LOCK_MINUTES]
      );
    }
    throw new AuthError('INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  await query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1', [user.id]);
  const token = crypto.randomBytes(32).toString('base64url');
  const { rows: session } = await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent)
     VALUES ($1, $2, NOW() + make_interval(days => $3), $4)
     RETURNING expires_at`,
    [user.id, sha256(token), SESSION_DAYS, typeof userAgent === 'string' ? userAgent.slice(0, 255) : null]
  );
  return { token, expiresAt: session[0].expires_at, user: publicUser(user) };
}

/** The signed-in user for a cookie token, or null if missing, unknown, expired or disabled. */
async function userForToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const { rows } = await query(
    `UPDATE sessions s SET last_seen_at = NOW()
       FROM users u
      WHERE s.token_hash = $1 AND s.user_id = u.id AND s.expires_at > NOW() AND u.status = 'active'
      RETURNING u.*`,
    [sha256(token)]
  );
  return rows[0] ? publicUser(rows[0]) : null;
}

async function logout(token) {
  if (typeof token === 'string') await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

/** Creates a user, or resets the password of an existing one (same email). Used by the CLI. */
async function upsertUser({ workshopId, email, password, fullName, role = 'owner' }) {
  const hash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO users (workshop_id, email, password_hash, full_name, role)
     VALUES ($1, lower($2), $3, $4, $5)
     ON CONFLICT ((lower(email))) DO UPDATE SET
       password_hash = EXCLUDED.password_hash, failed_login_count = 0, locked_until = NULL
     RETURNING *`,
    [workshopId, email.trim(), hash, fullName, role]
  );
  // A password reset signs the user out everywhere
  await query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]);
  return publicUser(rows[0]);
}

function publicUser(u) {
  return { id: u.id, email: u.email, full_name: u.full_name, role: u.role, workshop_id: u.workshop_id };
}

module.exports = {
  login,
  logout,
  userForToken,
  upsertUser,
  hashPassword,
  verifyPassword,
  AuthError,
  SESSION_DAYS,
  MAX_FAILED_LOGINS
};
