// Ids in this app are UUIDs. Checking the format first turns a malformed id into a clean 404
// instead of a Postgres "invalid input syntax for type uuid" error (500).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

// router.param handler: 404 with the given message when the id isn't a UUID
const requireUuidParam = (notFoundMessage) => (req, res, next, id) =>
  isUuid(id) ? next() : res.status(404).json({ error: notFoundMessage });

module.exports = { isUuid, requireUuidParam };
