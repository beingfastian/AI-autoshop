// Scheduling: which appointment times a shop can offer, and safely claiming one.
//
// All calendar logic runs in the shop's own timezone (luxon), because "Saturday 9:00-14:00"
// and holidays are local concepts; times are stored and compared as UTC instants.
//
// Safety rules:
// - Never overbook: a time is only offered/reserved while fewer than bay_count active
//   bookings overlap it.
// - Bad shop settings (missing or malformed hours) mean "closed", never invented hours.
// - reserveSlot() takes a per-shop advisory lock inside the caller's transaction, so two
//   callers can't both take the last bay. The lock is per shop rather than per slot because
//   bookings of different lengths that start at different times can still overlap.
const { DateTime } = require('luxon');

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ACTIVE_STATUSES = ['pending', 'confirmed'];
const LOCK_NAMESPACE = 41001; // first key of the two-key advisory lock: "booking slots"
const MAX_SEARCH_DAYS = 60;

class SchedulingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SchedulingError';
    this.code = code;
  }
}

function parseTime(value) {
  const match = typeof value === 'string' && TIME_RE.exec(value);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

// Opening hours for one local date as [open, close] DateTimes, or null when closed.
// Anything malformed is treated as closed (and logged once per call site) rather than guessed.
function hoursForDate(workshop, date, warn = () => {}) {
  const day = workshop.business_hours?.[DAYS[date.weekday - 1]];
  if (!day || day.closed === true) return null;

  const open = parseTime(day.open);
  const close = parseTime(day.close);
  if (!open || !close) {
    warn(`invalid business hours for ${DAYS[date.weekday - 1]}`);
    return null;
  }

  const openAt = date.set({ ...open, second: 0, millisecond: 0 });
  const closeAt = date.set({ ...close, second: 0, millisecond: 0 });
  if (closeAt <= openAt) {
    warn(`${DAYS[date.weekday - 1]} closes before it opens (overnight hours are not supported)`);
    return null;
  }
  return [openAt, closeAt];
}

function zoneFor(workshop) {
  const zone = workshop.timezone || 'Asia/Karachi';
  if (!DateTime.now().setZone(zone).isValid) {
    throw new SchedulingError('INVALID_TIMEZONE', `Workshop ${workshop.id} has an invalid timezone "${zone}"`);
  }
  return zone;
}

function durationFor(workshop, durationMinutes) {
  const minutes = durationMinutes ?? workshop.slot_minutes ?? 60;
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440) {
    throw new SchedulingError('INVALID_DURATION', 'Duration must be a whole number of minutes between 15 and 1440');
  }
  return minutes;
}

// Closed dates (local, inclusive) between two local dates, as a Set of 'YYYY-MM-DD'
async function closedDates(db, workshopId, firstDate, lastDate) {
  // Dates come back as text: pg would turn a DATE into a JS Date at *server* midnight
  const { rows } = await db.query(
    `SELECT to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on
       FROM closures
      WHERE workshop_id = $1 AND starts_on <= $3::date AND ends_on >= $2::date`,
    [workshopId, firstDate, lastDate]
  );
  const closed = new Set();
  for (const row of rows) {
    for (let d = DateTime.fromISO(row.starts_on); d.toISODate() <= row.ends_on; d = d.plus({ days: 1 })) {
      closed.add(d.toISODate());
    }
  }
  return closed;
}

// Active bookings overlapping [from, to) as { start, end } millisecond ranges.
// excludeBookingId leaves one booking out (the one being moved, so it doesn't block itself).
async function busyRanges(db, workshopId, from, to, excludeBookingId = null) {
  const { rows } = await db.query(
    `SELECT scheduled_at, COALESCE(duration_minutes, 60) AS duration_minutes
       FROM bookings
      WHERE workshop_id = $1
        AND status = ANY($4)
        AND scheduled_at < $3
        AND scheduled_at + make_interval(mins => COALESCE(duration_minutes, 60)) > $2
        AND ($5::uuid IS NULL OR id <> $5::uuid)`,
    [workshopId, from.toJSDate(), to.toJSDate(), ACTIVE_STATUSES, excludeBookingId]
  );
  return rows.map((r) => {
    const start = new Date(r.scheduled_at).getTime();
    return { start, end: start + r.duration_minutes * 60000 };
  });
}

// Most bookings running at the same moment anywhere inside [start, end)
function peakOverlap(busy, start, end) {
  const inside = busy.filter((b) => b.start < end && b.end > start);
  // the peak is always reached at the start of the window or at some booking's start
  const points = [start, ...inside.map((b) => b.start).filter((t) => t > start)];
  return Math.max(0, ...points.map((t) => inside.filter((b) => b.start <= t && b.end > t).length));
}

/**
 * Times the shop can still offer, earliest first.
 * @param db       pg pool or client
 * @param workshop workshops row
 * @param options  { from = now, now, days = 7, limit = 10, durationMinutes = workshop.slot_minutes, logger }
 * @returns [{ start: Date, end: Date, local: 'Monday, January 14 at 2:00 PM' }]
 */
async function getAvailableSlots(db, workshop, options = {}) {
  const zone = zoneFor(workshop);
  const duration = durationFor(workshop, options.durationMinutes);
  const days = Math.min(Math.max(options.days ?? 7, 1), MAX_SEARCH_DAYS);
  const limit = Math.max(options.limit ?? 10, 1);
  const step = workshop.slot_minutes || 60;
  const logger = options.logger || console;
  const warnings = new Set();
  const warn = (msg) => warnings.add(msg);

  const now = DateTime.fromJSDate(options.now || new Date()).setZone(zone);
  const requestedFrom = options.from ? DateTime.fromJSDate(new Date(options.from)).setZone(zone) : now;
  if (!requestedFrom.isValid) throw new SchedulingError('INVALID_TIME', 'Search start is not a valid time');
  const earliest = DateTime.max(requestedFrom, now.plus({ minutes: workshop.min_notice_minutes ?? 0 }));

  const firstDay = earliest.startOf('day');
  const lastDay = firstDay.plus({ days: days - 1 });
  const closed = await closedDates(db, workshop.id, firstDay.toISODate(), lastDay.toISODate());
  const busy = await busyRanges(db, workshop.id, firstDay, lastDay.endOf('day'));
  const capacity = workshop.bay_count || 1;

  const slots = [];
  for (let date = firstDay; date <= lastDay && slots.length < limit; date = date.plus({ days: 1 })) {
    if (closed.has(date.toISODate())) continue;
    const hours = hoursForDate(workshop, date, warn);
    if (!hours) continue;
    const [openAt, closeAt] = hours;

    for (let start = openAt; start.plus({ minutes: duration }) <= closeAt && slots.length < limit; start = start.plus({ minutes: step })) {
      if (start < earliest) continue;
      const end = start.plus({ minutes: duration });
      if (peakOverlap(busy, start.toMillis(), end.toMillis()) >= capacity) continue;
      slots.push({
        start: start.toUTC().toJSDate(),
        end: end.toUTC().toJSDate(),
        local: start.toFormat("cccc, LLLL d 'at' h:mm a")
      });
    }
  }

  for (const msg of warnings) logger.warn(`⚠️ Workshop ${workshop.id}: ${msg}; treating the day as closed`);
  return slots;
}

// Serializes bookings for one shop until the caller's transaction ends. Safe to call more than
// once in the same transaction (Postgres advisory locks stack per session).
async function lockWorkshopBookings(client, workshopId) {
  await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [LOCK_NAMESPACE, workshopId]);
}

/**
 * Claims a time for a new booking. Must run inside the caller's transaction (BEGIN ... COMMIT),
 * and the caller must insert the booking before committing: the lock is released at commit.
 * options: { durationMinutes, now, excludeBookingId (when moving an existing booking) }
 * Throws SchedulingError with code PAST, TOO_SOON, CLOSED, OUTSIDE_HOURS, SLOT_FULL or INVALID_TIME.
 * @returns { start: Date, end: Date }
 */
async function reserveSlot(client, workshop, start, options = {}) {
  const zone = zoneFor(workshop);
  const duration = durationFor(workshop, options.durationMinutes);
  const startAt = DateTime.fromJSDate(new Date(start)).setZone(zone);
  if (!start || !startAt.isValid) throw new SchedulingError('INVALID_TIME', 'Appointment time is not a valid date');
  const endAt = startAt.plus({ minutes: duration });
  const now = DateTime.fromJSDate(options.now || new Date());

  if (startAt <= now) throw new SchedulingError('PAST', 'That time has already passed');
  if (startAt < now.plus({ minutes: workshop.min_notice_minutes ?? 0 })) {
    throw new SchedulingError('TOO_SOON', `Bookings need at least ${workshop.min_notice_minutes} minutes' notice`);
  }

  const date = startAt.startOf('day');
  const closed = await closedDates(client, workshop.id, date.toISODate(), date.toISODate());
  const hours = !closed.has(date.toISODate()) && hoursForDate(workshop, date);
  if (!hours) throw new SchedulingError('CLOSED', `The shop is closed on ${startAt.toFormat('cccc, LLLL d')}`);
  if (startAt < hours[0] || endAt > hours[1]) {
    throw new SchedulingError(
      'OUTSIDE_HOURS',
      `That day the shop is open ${hours[0].toFormat('h:mm a')} to ${hours[1].toFormat('h:mm a')}`
    );
  }

  await lockWorkshopBookings(client, workshop.id);

  const busy = await busyRanges(client, workshop.id, startAt, endAt, options.excludeBookingId || null);
  if (peakOverlap(busy, startAt.toMillis(), endAt.toMillis()) >= (workshop.bay_count || 1)) {
    throw new SchedulingError('SLOT_FULL', 'That time is fully booked');
  }

  return { start: startAt.toUTC().toJSDate(), end: endAt.toUTC().toJSDate() };
}

module.exports = { getAvailableSlots, reserveSlot, lockWorkshopBookings, SchedulingError, ACTIVE_STATUSES };
