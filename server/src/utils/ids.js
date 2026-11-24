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
