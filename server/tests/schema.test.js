// Database-level guarantees from migrations 0003-0006: bad data is rejected by Postgres itself,
// so a bug in application code can't write it
const { pool, resetDb, createWorkshop } = require('./helpers');

let workshop;

beforeEach(async () => {
  await resetDb();
  workshop = await createWorkshop();
});

afterAll(() => pool.end());

async function createBookingRow(overrides = {}) {
  const customer = await pool.query(
    `INSERT INTO customers (workshop_id, name, phone) VALUES ($1, 'Ali', $2) RETURNING id`,
    [workshop.id, `+92300${Math.floor(Math.random() * 1e7)}`]
  );
  const { rows } = await pool.query(
    `INSERT INTO bookings (workshop_id, customer_id, call_id, scheduled_at, issue_summary, status)
     VALUES ($1, $2, $3, $4, 'Brake noise', $5) RETURNING *`,
    [workshop.id, customer.rows[0].id, overrides.call_id || null, overrides.scheduled_at || '2030-01-15T19:00:00Z', overrides.status || 'confirmed']
  );
  return rows[0];
}

describe('timestamps', () => {
  test('a booking time means the same instant whatever the session timezone', async () => {
    const client = await pool.connect();
    try {
      await client.query("SET TIME ZONE 'America/Los_Angeles'"); // differs from the shop (New York) and the server (UTC)
      const customer = await client.query(
        `INSERT INTO customers (workshop_id, name, phone) VALUES ($1, 'Ali', '+923001112222') RETURNING id`,
        [workshop.id]
      );
      const { rows } = await client.query(
        `INSERT INTO bookings (workshop_id, customer_id, scheduled_at, issue_summary)
         VALUES ($1, $2, '2030-01-15T19:00:00Z', 'x') RETURNING scheduled_at`,
        [workshop.id, customer.rows[0].id]
      );
      expect(rows[0].scheduled_at.toISOString()).toBe('2030-01-15T19:00:00.000Z');
    } finally {
      await client.query('RESET TIME ZONE');
      client.release();
    }
  });

  test('daily stats group by the shop\'s local date', async () => {
    // 02:00 UTC on the 15th is still 9:00 PM on the 14th in New York (UTC-5)
    await createBookingRow({ scheduled_at: '2030-01-15T02:00:00Z' });
    const { rows } = await pool.query('SELECT to_char(date, \'YYYY-MM-DD\') AS date FROM booking_stats_daily WHERE workshop_id = $1', [workshop.id]);
    expect(rows).toEqual([{ date: '2030-01-14' }]);
  });
});

describe('workshops', () => {
  test('new shops get sensible scheduling settings', async () => {
    const { rows } = await pool.query('SELECT * FROM workshops WHERE id = $1', [workshop.id]);
    expect(rows[0]).toMatchObject({ timezone: 'America/New_York', slot_minutes: 60, bay_count: 2, min_notice_minutes: 60, notify_emails: [] });
  });

  test('a new shop must state its timezone: there is no default to silently get wrong', async () => {
    await expect(
      pool.query("INSERT INTO workshops (name, email, phone) VALUES ('No TZ', 'notz@test.local', '+15550000000')")
    ).rejects.toThrow(/Every workshop needs a timezone, such as America\/New_York/);
  });

  test('rejects an unknown timezone name', async () => {
    await expect(pool.query("UPDATE workshops SET timezone = 'America/New_Yrok' WHERE id = $1", [workshop.id]))
      .rejects.toThrow(/Unknown timezone "America\/New_Yrok". Use an IANA name such as America\/New_York/);
  });

  test('accepts a valid timezone change', async () => {
    await pool.query("UPDATE workshops SET timezone = 'Asia/Dubai' WHERE id = $1", [workshop.id]);
  });

  test.each([
    ['slot_minutes', 0],
    ['bay_count', 0],
    ['min_notice_minutes', -5]
  ])('rejects %s = %s', async (column, value) => {
    await expect(pool.query(`UPDATE workshops SET ${column} = $2 WHERE id = $1`, [workshop.id, value])).rejects.toThrow(/check constraint/);
  });
});

describe('bookings', () => {
  test('rejects an unknown status', async () => {
    await expect(createBookingRow({ status: 'bogus' })).rejects.toThrow(/bookings_status_check/);
  });

  test('a cancelled booking must record when it was cancelled', async () => {
    const booking = await createBookingRow();
    await expect(pool.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [booking.id]))
      .rejects.toThrow(/bookings_cancellation_check/);
  });

  test('only one booking per call', async () => {
    const call = await pool.query(
      `INSERT INTO calls (workshop_id, from_number, to_number) VALUES ($1, '+923001112222', $2) RETURNING id`,
      [workshop.id, workshop.vapi_phone_number]
    );
    await createBookingRow({ call_id: call.rows[0].id });
    await expect(createBookingRow({ call_id: call.rows[0].id })).rejects.toThrow(/bookings_call_id_unique/);
  });

  test('bookings without a call (manual bookings) are not limited', async () => {
    await createBookingRow();
    await createBookingRow();
  });
});

describe('closures', () => {
  test('rejects a closure that ends before it starts', async () => {
    await expect(
      pool.query("INSERT INTO closures (workshop_id, starts_on, ends_on) VALUES ($1, '2030-04-12', '2030-04-10')", [workshop.id])
    ).rejects.toThrow(/check constraint/);
  });

  test('a multi-day closure (e.g. Eid) is allowed', async () => {
    await pool.query("INSERT INTO closures (workshop_id, starts_on, ends_on, reason) VALUES ($1, '2030-04-10', '2030-04-12', 'Eid')", [workshop.id]);
  });
});

describe('webhook_events and notifications', () => {
  test('the same webhook can only be stored once', async () => {
    const insert = () =>
      pool.query(`INSERT INTO webhook_events (event_type, dedupe_key, payload) VALUES ('end-of-call-report', 'call-1:end', '{}')`);
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });

  test('the same notification can only be queued once per booking, kind, channel and recipient', async () => {
    const booking = await createBookingRow();
    const insert = () =>
      pool.query(
        `INSERT INTO notifications (booking_id, channel, kind, recipient) VALUES ($1, 'email', 'reminder_24h', 'a@b.c')`,
        [booking.id]
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });

  test('a notification marked sent must have a sent time', async () => {
    const booking = await createBookingRow();
    await expect(
      pool.query(
        `INSERT INTO notifications (booking_id, channel, kind, recipient, status) VALUES ($1, 'email', 'reminder_2h', 'a@b.c', 'sent')`,
        [booking.id]
      )
    ).rejects.toThrow(/check constraint/);
  });
});
