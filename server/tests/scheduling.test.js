// Scheduling rules, checked against the real database. Dates are in 2030 so they stay in the future.
// 2030-01-13 is a Sunday; default hours: Mon-Fri 08:00-18:00, Sat 09:00-14:00, Sun closed.
const { DateTime } = require('luxon');
const { getAvailableSlots, reserveSlot, SchedulingError } = require('../src/services/scheduling');
const { pool, resetDb, createWorkshop } = require('./helpers');

const at = (iso, zone = 'Asia/Karachi') => DateTime.fromISO(iso, { zone }).toJSDate();
const locals = (slots) => slots.map((s) => s.local);
const quietLogger = { warn: jest.fn() };

let workshop;
let customerId;

async function configure(changes) {
  const keys = Object.keys(changes);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => (k === 'business_hours' && changes[k] !== null ? JSON.stringify(changes[k]) : changes[k]));
  workshop = (await pool.query(`UPDATE workshops SET ${sets} WHERE id = $1 RETURNING *`, [workshop.id, ...values])).rows[0];
}

async function book(start, { minutes = 60, status = 'confirmed' } = {}) {
  await pool.query(
    `INSERT INTO bookings (workshop_id, customer_id, scheduled_at, duration_minutes, issue_summary, status, cancelled_at)
     VALUES ($1, $2, $3, $4, 'x', $5::varchar, CASE WHEN $5::varchar = 'cancelled' THEN NOW() END)`,
    [workshop.id, customerId, start, minutes, status]
  );
}

const slots = (options) => getAvailableSlots(pool, workshop, { logger: quietLogger, ...options });

beforeEach(async () => {
  await resetDb();
  workshop = (await pool.query('SELECT * FROM workshops WHERE id = $1', [(await createWorkshop()).id])).rows[0];
  customerId = (await pool.query(
    `INSERT INTO customers (workshop_id, name, phone) VALUES ($1, 'Ali', '+923001234567') RETURNING id`,
    [workshop.id]
  )).rows[0].id;
  quietLogger.warn.mockClear();
});

afterAll(() => pool.end());

describe('getAvailableSlots', () => {
  test('offers every hour of a weekday, in the shop\'s timezone', async () => {
    const result = await slots({ now: at('2030-01-13T12:00'), from: at('2030-01-14T00:00'), days: 1, limit: 50 });
    expect(result).toHaveLength(10);
    expect(result[0]).toMatchObject({ start: new Date('2030-01-14T03:00:00Z'), local: 'Monday, January 14 at 8:00 AM' });
    expect(result[9].local).toBe('Monday, January 14 at 5:00 PM'); // last one still ends by 6:00 PM closing
  });

  test('skips Sunday when the shop is closed', async () => {
    expect(await slots({ now: at('2030-01-13T06:00'), days: 1 })).toEqual([]);
    const next = await slots({ now: at('2030-01-13T06:00'), days: 2, limit: 1 });
    expect(locals(next)).toEqual(['Monday, January 14 at 8:00 AM']);
  });

  test('uses Saturday\'s shorter hours', async () => {
    const result = await slots({ now: at('2030-01-18T20:00'), days: 1, from: at('2030-01-19T00:00'), limit: 50 });
    expect(locals(result).map((l) => l.split(' at ')[1])).toEqual(['9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM']);
  });

  test('a long job must finish by closing time', async () => {
    // Saturday closes 14:00; a 90-minute job starting at 13:00 would run past it
    const result = await slots({ now: at('2030-01-18T20:00'), from: at('2030-01-19T00:00'), days: 1, durationMinutes: 90, limit: 50 });
    expect(locals(result).map((l) => l.split(' at ')[1])).toEqual(['9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM']);
  });

  test('skips holidays, including multi-day closures', async () => {
    await pool.query(
      `INSERT INTO closures (workshop_id, starts_on, ends_on, reason) VALUES ($1, '2030-01-14', '2030-01-15', 'Eid')`,
      [workshop.id]
    );
    const result = await slots({ now: at('2030-01-13T12:00'), limit: 1 });
    expect(locals(result)).toEqual(['Wednesday, January 16 at 8:00 AM']);
  });

  test('respects the minimum notice period', async () => {
    await configure({ min_notice_minutes: 60 });
    // 10:20 + 60 min notice = 11:20, so 11:00 is too soon
    const result = await slots({ now: at('2030-01-14T10:20'), limit: 1 });
    expect(locals(result)).toEqual(['Monday, January 14 at 12:00 PM']);
  });

  test('a full time is skipped and the next options are offered', async () => {
    await book(at('2030-01-14T10:00'));
    await book(at('2030-01-14T10:00')); // 2 bays, both taken
    const result = await slots({ now: at('2030-01-13T12:00'), limit: 3 });
    expect(locals(result).map((l) => l.split(' at ')[1])).toEqual(['8:00 AM', '9:00 AM', '11:00 AM']);
  });

  test('a booking that starts mid-slot still blocks the slots it overlaps', async () => {
    await configure({ bay_count: 1 });
    await book(at('2030-01-14T10:30')); // 10:30-11:30 overlaps both 10:00 and 11:00
    const result = await slots({ now: at('2030-01-13T12:00'), limit: 4 });
    expect(locals(result).map((l) => l.split(' at ')[1])).toEqual(['8:00 AM', '9:00 AM', '12:00 PM', '1:00 PM']);
  });

  test('cancelled bookings free their bay', async () => {
    await configure({ bay_count: 1 });
    await book(at('2030-01-14T08:00'), { status: 'cancelled' });
    const result = await slots({ now: at('2030-01-13T12:00'), limit: 1 });
    expect(locals(result)).toEqual(['Monday, January 14 at 8:00 AM']);
  });

  test('malformed or missing hours mean closed, with a warning, never guessed hours', async () => {
    await configure({ business_hours: { monday: { open: '8am', close: '6pm' }, tuesday: { open: '18:00', close: '08:00' } } });
    expect(await slots({ now: at('2030-01-13T12:00'), days: 3 })).toEqual([]);
    expect(quietLogger.warn).toHaveBeenCalledWith(expect.stringMatching(/invalid business hours for monday/));
    expect(quietLogger.warn).toHaveBeenCalledWith(expect.stringMatching(/tuesday closes before it opens/));

    await configure({ business_hours: null });
    expect(await slots({ now: at('2030-01-13T12:00'), days: 7 })).toEqual([]);
  });

  test('daylight-saving day: times stay correct and the missing hour is never offered', async () => {
    // US clocks jump from 02:00 to 03:00 on Sunday 2030-03-10
    await pool.query("UPDATE workshops SET timezone = 'America/New_York' WHERE id = $1", [workshop.id]);
    await configure({
      business_hours: {
        saturday: { open: '09:00', close: '10:00' },
        sunday: { open: '01:00', close: '05:00' },
        monday: { open: '09:00', close: '10:00' }
      }
    });
    const ny = (iso) => at(iso, 'America/New_York');
    const result = await slots({ now: ny('2030-03-08T12:00'), days: 4, limit: 50 });
    expect(result.map((s) => [s.local, s.start.toISOString()])).toEqual([
      ['Saturday, March 9 at 9:00 AM', '2030-03-09T14:00:00.000Z'], // EST, UTC-5
      ['Sunday, March 10 at 1:00 AM', '2030-03-10T06:00:00.000Z'],
      ['Sunday, March 10 at 3:00 AM', '2030-03-10T07:00:00.000Z'], // 2:00 AM doesn't exist
      ['Sunday, March 10 at 4:00 AM', '2030-03-10T08:00:00.000Z'],
      ['Monday, March 11 at 9:00 AM', '2030-03-11T13:00:00.000Z'] // EDT, UTC-4
    ]);
  });
});

describe('reserveSlot', () => {
  async function reserve(start, options) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      return await reserveSlot(client, workshop, start, { now: at('2030-01-13T12:00'), ...options });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  const rejects = (promise, code) => expect(promise).rejects.toMatchObject({ name: 'SchedulingError', code });

  test('accepts an open time and returns its start and end', async () => {
    expect(await reserve(at('2030-01-14T10:00'))).toEqual({
      start: new Date('2030-01-14T05:00:00Z'),
      end: new Date('2030-01-14T06:00:00Z')
    });
  });

  test.each([
    ['a time that has passed', '2030-01-13T11:00', 'PAST'],
    ['a closed day (Sunday)', '2030-01-20T10:00', 'CLOSED'],
    ['a time that runs past closing', '2030-01-14T17:30', 'OUTSIDE_HOURS'],
    ['a time before opening', '2030-01-14T07:00', 'OUTSIDE_HOURS']
  ])('rejects %s', async (_, time, code) => {
    await rejects(reserve(at(time)), code);
  });

  test('rejects a time inside the notice period', async () => {
    await configure({ min_notice_minutes: 120 });
    await rejects(reserve(at('2030-01-14T10:00'), { now: at('2030-01-14T09:00') }), 'TOO_SOON');
  });

  test('rejects a holiday', async () => {
    await pool.query(`INSERT INTO closures (workshop_id, starts_on, ends_on) VALUES ($1, '2030-01-14', '2030-01-14')`, [workshop.id]);
    await rejects(reserve(at('2030-01-14T10:00')), 'CLOSED');
  });

  test('rejects a full time', async () => {
    await book(at('2030-01-14T10:00'));
    await book(at('2030-01-14T10:00'));
    await rejects(reserve(at('2030-01-14T10:00')), 'SLOT_FULL');
  });

  test.each([undefined, null, 'not a date'])('rejects an invalid time (%p)', async (value) => {
    await rejects(reserve(value), 'INVALID_TIME');
  });

  test('5 people booking the same 2-bay time at once: exactly 2 succeed', async () => {
    const start = at('2030-01-14T10:00');
    const attempt = async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const slot = await reserveSlot(client, workshop, start, { now: at('2030-01-13T12:00') });
        await client.query(
          `INSERT INTO bookings (workshop_id, customer_id, scheduled_at, issue_summary, status)
           VALUES ($1, $2, $3, 'x', 'confirmed')`,
          [workshop.id, customerId, slot.start]
        );
        await client.query('COMMIT');
        return 'booked';
      } catch (e) {
        await client.query('ROLLBACK');
        if (e instanceof SchedulingError) return e.code;
        throw e;
      } finally {
        client.release();
      }
    };

    const results = await Promise.all(Array.from({ length: 5 }, attempt));
    expect(results.filter((r) => r === 'booked')).toHaveLength(2);
    expect(results.filter((r) => r === 'SLOT_FULL')).toHaveLength(3);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM bookings WHERE scheduled_at = $1', [start]);
    expect(rows[0].n).toBe(2);
  });
});
