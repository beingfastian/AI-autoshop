// Ids in this app are UUIDs. Checking the format first turns a malformed id into a clean 404
// instead of a Postgres "invalid input syntax for type uuid" error (500).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

// router.param handler: 404 with the given message when the id isn't a UUID
const requireUuidParam = (notFoundMessage) => (req, res, next, id) =>
  isUuid(id) ? next() : res.status(404).json({ error: notFoundMessage });

module.exports = { isUuid, requireUuidParam };

// router.param handler (after requireUuidParam): a signed-in user may only reach rows of their own
// shop. Another shop's row answers 404, the same as a missing one, so ids can't be probed.
const requireOwnRow = (table, notFoundMessage) => async (req, res, next, id) => {
  const workshopId = req.auth?.kind === 'user' ? req.auth.workshopId : null;
  if (!workshopId) return next();
  try {
    const { query } = require('../config/database');
    const { rows } = await query(`SELECT workshop_id FROM ${table} WHERE id = $1`, [id]);
    if (rows[0] && rows[0].workshop_id !== workshopId) return res.status(404).json({ error: notFoundMessage });
    next();
  } catch (error) {
    next(error);
  }
};

module.exports.requireOwnRow = requireOwnRow;

// Page size and offset from query strings: whole numbers, limit 1-200 (default 50), offset >= 0.
// Unchecked, "?limit=abc" is a 500 and "?limit=10000000" makes the DB do needless work.
function pageParams({ limit, offset } = {}) {
  const l = Number.parseInt(limit, 10);
  const o = Number.parseInt(offset, 10);
  return {
    limit: Number.isFinite(l) ? Math.min(Math.max(l, 1), 200) : 50,
    offset: Number.isFinite(o) ? Math.max(o, 0) : 0
  };
}

module.exports.pageParams = pageParams;
