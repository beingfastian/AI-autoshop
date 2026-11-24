// The signed-in user's shop settings (for the dashboard).
//   GET    /api/workshop                    settings
//   PUT    /api/workshop                    change settings (owner)
//   GET    /api/workshop/closures           upcoming closed days
//   POST   /api/workshop/closures           add closed days (owner)
//   DELETE /api/workshop/closures/:id       remove closed days (owner)
// One bad value here (hours that close before they open, an unknown timezone) would break every
// booking for the shop, so everything is validated and rejected with a clear 400.
const express = require('express');
const { DateTime } = require('luxon');
const { query } = require('../config/database');
const { normalizePhone } = require('../services/bookings');
const { requireRole, scopedWorkshopId } = require('../middleware/session');
const { requireUuidParam } = require('../utils/ids');

const router = express.Router();
const ownerOnly = requireRole('owner', 'admin');
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELDS = 'id, name, email, phone, address, timezone, business_hours, slot_minutes, bay_count, ' +
  'min_notice_minutes, transfer_phone, notify_emails, notify_sms, ai_phone_number, status';

// The admin key isn't tied to a shop, so these routes need a signed-in user
router.use((req, res, next) =>
  scopedWorkshopId(req) ? next() : res.status(400).json({ error: 'Sign in as shop staff to manage a shop' }));

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT ${FIELDS} FROM workshops WHERE id = $1`, [scopedWorkshopId(req)]);
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

function validateHours(hours, problems) {
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) {
    problems.push('business_hours must give each day of the week');
    return null;
  }
  const out = {};
  for (const day of DAYS) {
    const h = hours[day];
    if (!h || h.closed === true) {
      out[day] = { closed: true };
    } else if (TIME.test(h.open) && TIME.test(h.close) && h.close > h.open) {
      out[day] = { open: h.open, close: h.close };
    } else {
      problems.push(`${day}: give open and close as HH:MM (24-hour), with close after open, or mark it closed`);
    }
  }
  return out;
}

const intIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

router.put('/', ownerOnly, async (req, res, next) => {
  const body = req.body || {};
  const problems = [];
  const updates = {};

  if (body.name !== undefined) {
    if (typeof body.name === 'string' && body.name.trim() && body.name.length <= 255) updates.name = body.name.trim();
    else problems.push('name must be 1-255 characters');
  }
  if (body.address !== undefined) {
    if (body.address === null || (typeof body.address === 'string' && body.address.length <= 500)) updates.address = body.address?.trim() || null;
    else problems.push('address must be at most 500 characters');
  }
  if (body.phone !== undefined) {
    const phone = normalizePhone(body.phone);
    if (phone) updates.phone = phone;
    else problems.push('phone must be a valid phone number');
  }
  if (body.transfer_phone !== undefined) {
    const phone = body.transfer_phone === null || body.transfer_phone === '' ? null : normalizePhone(body.transfer_phone);
    if (phone !== null || body.transfer_phone === null || body.transfer_phone === '') updates.transfer_phone = phone;
    else problems.push('transfer_phone must be a valid phone number, or empty for none');
  }
  if (body.timezone !== undefined) {
    if (typeof body.timezone === 'string' && DateTime.now().setZone(body.timezone).isValid) updates.timezone = body.timezone;
    else problems.push('timezone must be an IANA name such as America/New_York');
  }
  if (body.business_hours !== undefined) {
    const hours = validateHours(body.business_hours, problems);
    if (hours) updates.business_hours = JSON.stringify(hours);
  }
  if (body.slot_minutes !== undefined) {
    if (intIn(body.slot_minutes, 15, 480)) updates.slot_minutes = body.slot_minutes;
    else problems.push('slot_minutes must be a whole number from 15 to 480');
  }
  if (body.bay_count !== undefined) {
    if (intIn(body.bay_count, 1, 100)) updates.bay_count = body.bay_count;
    else problems.push('bay_count must be a whole number from 1 to 100');
  }
  if (body.min_notice_minutes !== undefined) {
    if (intIn(body.min_notice_minutes, 0, 10080)) updates.min_notice_minutes = body.min_notice_minutes;
    else problems.push('min_notice_minutes must be a whole number from 0 to 10080 (one week)');
  }
  if (body.notify_emails !== undefined) {
    const list = Array.isArray(body.notify_emails) ? [...new Set(body.notify_emails.map((e) => String(e).trim().toLowerCase()))] : null;
    if (list && list.length <= 10 && list.every((e) => EMAIL.test(e))) updates.notify_emails = list;
    else problems.push('notify_emails must be a list of up to 10 email addresses');
  }
  if (body.notify_sms !== undefined) {
    const list = Array.isArray(body.notify_sms) ? body.notify_sms.map(normalizePhone) : null;
    if (list && list.length <= 5 && list.every(Boolean)) updates.notify_sms = [...new Set(list)];
    else problems.push('notify_sms must be a list of up to 5 phone numbers');
  }

  if (problems.length) return res.status(400).json({ error: 'Some settings are invalid', details: problems });
  const keys = Object.keys(updates);
  if (!keys.length) return res.status(400).json({ error: 'No settings to change' });

  try {
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const { rows } = await query(
      `UPDATE workshops SET ${sets} WHERE id = $1 RETURNING ${FIELDS}`,
      [scopedWorkshopId(req), ...keys.map((k) => updates[k])]
    );
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s) => typeof s === 'string' && DATE.test(s) && DateTime.fromISO(s).isValid && DateTime.fromISO(s).toISODate() === s;

router.get('/closures', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, to_char(c.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(c.ends_on, 'YYYY-MM-DD') AS ends_on, c.reason
         FROM closures c JOIN workshops w ON w.id = c.workshop_id
        WHERE c.workshop_id = $1 AND c.ends_on >= (NOW() AT TIME ZONE w.timezone)::date
        ORDER BY c.starts_on`,
      [scopedWorkshopId(req)]
    );
    res.json({ closures: rows });
  } catch (error) {
    next(error);
  }
});

router.post('/closures', ownerOnly, async (req, res, next) => {
  const { starts_on: start, ends_on: end = req.body?.starts_on, reason } = req.body || {};
  const problems = [];
  if (!validDate(start)) problems.push('starts_on must be a date as YYYY-MM-DD');
  if (!validDate(end)) problems.push('ends_on must be a date as YYYY-MM-DD');
  if (!problems.length && end < start) problems.push('ends_on must be on or after starts_on');
  if (!problems.length && DateTime.fromISO(end).diff(DateTime.fromISO(start), 'days').days > 366) problems.push('a closure can be at most a year');
  if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > 255)) problems.push('reason must be at most 255 characters');
  if (problems.length) return res.status(400).json({ error: 'Invalid closure', details: problems });

  try {
    const { rows } = await query(
      `INSERT INTO closures (workshop_id, starts_on, ends_on, reason) VALUES ($1, $2, $3, $4)
       RETURNING id, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on, reason`,
      [scopedWorkshopId(req), start, end, reason?.trim() || null]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

router.param('closureId', requireUuidParam('Closure not found'));

router.delete('/closures/:closureId', ownerOnly, async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM closures WHERE id = $1 AND workshop_id = $2', [req.params.closureId, scopedWorkshopId(req)]);
    if (!rowCount) return res.status(404).json({ error: 'Closure not found' });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
