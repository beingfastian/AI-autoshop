// One way to create a booking, used by the REST API and by the call webhook (and, in 1.9, the
// voice agent's booking tool), so every booking gets the same validation and slot checks.
//
// createBooking() runs inside the caller's transaction (BEGIN ... COMMIT) and:
//   1. loads the shop and serializes bookings for it (advisory lock)
//   2. returns the existing booking if this call already has one (webhook retries are harmless)
//   3. finds or creates the customer by phone (caller ID when the AI didn't capture one)
//   4. reuses the customer's vehicle when it's the same car
//   5. reserves the slot (scheduling rules, capacity) and inserts the booking
// Sending emails is the caller's job, after COMMIT, so nothing is sent for a rolled-back booking.
const { DateTime } = require('luxon');
const { reserveSlot, lockWorkshopBookings, SchedulingError } = require('./scheduling');

const ISSUE_CATEGORIES = ['brakes', 'engine', 'transmission', 'electrical', 'tires', 'other'];
const URGENCIES = ['urgent', 'normal', 'low'];

class BookingError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'BookingError';
    this.code = code;
    this.details = details;
  }
}

const clean = (value, max) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
};

// Keeps a leading + and digits only: "+92 300-123 4567" and "+923001234567" are the same customer
function normalizePhone(value) {
  const text = clean(value, 40);
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return (text.startsWith('+') ? '+' : '') + digits;
}

function normalizeEmail(value) {
  const text = clean(value, 255);
  return text && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text.toLowerCase() : null;
}

function normalizeYear(value) {
  const year = Number(value);
  const max = new Date().getUTCFullYear() + 1;
  return Number.isInteger(year) && year >= 1950 && year <= max ? year : null;
}

// AI output is free text: anything unexpected falls back to a safe default instead of failing the call
const normalizeCategory = (value) => {
  const v = clean(value, 50)?.toLowerCase();
  return ISSUE_CATEGORIES.includes(v) ? v : 'other';
};
const normalizeUrgency = (value) => {
  const v = clean(value, 20)?.toLowerCase();
  return URGENCIES.includes(v) ? v : 'normal';
};

/**
 * A caller's requested date and time ("2030-01-15", "14:00" / "2pm" / "2:30 PM") as an instant in
 * the shop's timezone, or null if it can't be read with certainty. Never guesses.
 */
function parseRequestedTime(date, time, zone) {
  const d = clean(date, 20);
  const t = clean(time, 20)?.toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
  if (!d || !t || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;

  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(t);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3];
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  } else if (!match[2]) {
    return null; // a bare "2" could be 2 AM or 2 PM
  }
  if (hour > 23 || minute > 59) return null;

  const local = DateTime.fromISO(d, { zone }).set({ hour, minute, second: 0, millisecond: 0 });
  // reject impossible dates (2030-02-30) and times skipped by a DST change
  if (!local.isValid || local.toISODate() !== d || local.hour !== hour || local.minute !== minute) return null;
  return local.toJSDate();
}

/** Validates and normalizes a booking request. Throws BookingError('INVALID_INPUT') listing every problem. */
function normalizeInput(input) {
  const out = {
    workshopId: clean(input.workshopId, 36),
    callId: input.callId || null,
    customer: {
      name: clean(input.customer?.name, 255),
      phone: normalizePhone(input.customer?.phone) || normalizePhone(input.customer?.fallbackPhone),
      email: normalizeEmail(input.customer?.email)
    },
    vehicle: {
      make: clean(input.vehicle?.make, 100),
      model: clean(input.vehicle?.model, 100),
      year: normalizeYear(input.vehicle?.year)
    },
    issue: {
      summary: clean(input.issue?.summary, 2000),
      category: normalizeCategory(input.issue?.category),
      urgency: normalizeUrgency(input.issue?.urgency)
    },
    scheduledAt: input.scheduledAt,
    durationMinutes: input.durationMinutes
  };

  const problems = [];
  if (!out.workshopId || !/^[0-9a-f-]{36}$/i.test(out.workshopId)) problems.push('workshop_id must be a valid id');
  if (!out.customer.name) problems.push('customer_name is required');
  if (!out.customer.phone) problems.push('customer_phone must be a phone number with 7-15 digits');
  if (!out.issue.summary) problems.push('issue_summary is required');
  if (!out.scheduledAt || Number.isNaN(new Date(out.scheduledAt).getTime())) problems.push('scheduled_at must be a valid date and time');
  if (out.durationMinutes !== undefined && !Number.isInteger(out.durationMinutes)) problems.push('duration_minutes must be a whole number');
  if (problems.length) throw new BookingError('INVALID_INPUT', 'Invalid booking request', problems);
  return out;
}

async function findOrCreateCustomer(client, workshopId, customer) {
  // ON CONFLICT keeps this safe if two bookings for a new caller race
  const { rows } = await client.query(
    `INSERT INTO customers (workshop_id, name, phone, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workshop_id, phone) DO UPDATE
       SET email = COALESCE(customers.email, EXCLUDED.email)
     RETURNING id`,
    [workshopId, customer.name, customer.phone, customer.email]
  );
  return rows[0].id;
}

async function findOrCreateVehicle(client, customerId, vehicle) {
  if (!vehicle.make || !vehicle.model) return null;
  const existing = await client.query(
    `SELECT id, year FROM vehicles
      WHERE customer_id = $1 AND lower(make) = lower($2) AND lower(model) = lower($3)
        AND (year IS NULL OR $4::int IS NULL OR year = $4::int)
      ORDER BY (year = $4::int) DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [customerId, vehicle.make, vehicle.model, vehicle.year]
  );
  if (existing.rows.length) {
    const found = existing.rows[0];
    if (found.year === null && vehicle.year !== null) {
      await client.query('UPDATE vehicles SET year = $2 WHERE id = $1', [found.id, vehicle.year]);
    }
    return found.id;
  }
  const { rows } = await client.query(
    `INSERT INTO vehicles (customer_id, make, model, year) VALUES ($1, $2, $3, $4) RETURNING id`,
    [customerId, vehicle.make, vehicle.model, vehicle.year]
  );
  return rows[0].id;
}

/**
 * @param client pg client inside an open transaction
 * @param input  { workshopId, callId?, customer: { name, phone, email, fallbackPhone }, vehicle: { make, model, year },
 *                 issue: { summary, category, urgency }, scheduledAt, durationMinutes? }
 * @returns { booking, created } - created is false when the call already had a booking
 * @throws BookingError (INVALID_INPUT, WORKSHOP_NOT_FOUND, WORKSHOP_INACTIVE) or SchedulingError
 */
async function createBooking(client, input, { now } = {}) {
  const data = normalizeInput(input);

  const { rows: shops } = await client.query('SELECT * FROM workshops WHERE id = $1', [data.workshopId]);
  const workshop = shops[0];
  if (!workshop) throw new BookingError('WORKSHOP_NOT_FOUND', 'Workshop not found');
  if (workshop.status !== 'active') throw new BookingError('WORKSHOP_INACTIVE', 'This workshop is not taking bookings');

  // Held until the transaction ends: makes the "already booked for this call" check and the
  // capacity check race-free
  await lockWorkshopBookings(client, workshop.id);

  if (data.callId) {
    const existing = await client.query('SELECT * FROM bookings WHERE call_id = $1', [data.callId]);
    if (existing.rows.length) return { booking: existing.rows[0], created: false };
  }

  const slot = await reserveSlot(client, workshop, data.scheduledAt, { durationMinutes: data.durationMinutes, now });
  const customerId = await findOrCreateCustomer(client, workshop.id, data.customer);
  const vehicleId = await findOrCreateVehicle(client, customerId, data.vehicle);

  const { rows } = await client.query(
    `INSERT INTO bookings (
       workshop_id, customer_id, vehicle_id, call_id, scheduled_at, duration_minutes,
       issue_summary, issue_category, urgency, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed')
     RETURNING *`,
    [
      workshop.id, customerId, vehicleId, data.callId, slot.start,
      Math.round((slot.end - slot.start) / 60000),
      data.issue.summary, data.issue.category, data.issue.urgency
    ]
  );
  return { booking: rows[0], created: true };
}

module.exports = {
  createBooking,
  parseRequestedTime,
  normalizePhone,
  BookingError,
  SchedulingError,
  ISSUE_CATEGORIES,
  URGENCIES
};
