// Loads the demo shop shown on the public demo: 14 days of calls with transcripts, bookings,
// callers waiting for a call back, and upcoming holidays. All names and numbers are made up.
//
//   DEMO_PASSWORD=... npm --prefix server run demo:seed -- --yes
//
// It replaces ONLY the demo shop (found by its fixed email) and leaves every other shop alone.
// Dates are relative to today, so re-run it any time to make the demo look current again.
// The demo login has the staff role: visitors can explore everything but can't change settings.
require('dotenv').config();
const { DateTime } = require('luxon');
const { pool, getClient } = require('../config/database');
const { upsertUser } = require('../services/auth');

const SHOP_EMAIL = 'demo-shop@wrenchline.app';
const LOGIN_EMAIL = 'demo@wrenchline.app';
const TZ = 'America/New_York';

const PEOPLE = [
  ['Maria Lopez', '+13125550142', 'Honda', 'Civic', 2019, 'Grinding noise when braking', 'brakes'],
  ['James Carter', '+13125550178', 'Ford', 'F-150', 2017, 'Check engine light came on this morning', 'engine'],
  ['Aisha Patel', '+13125550111', 'Toyota', 'RAV4', 2021, 'Due for oil change and tire rotation', 'other'],
  ['David Kim', '+13125550190', 'Chevrolet', 'Malibu', 2016, 'Car shakes above 60 mph', 'tires'],
  ['Sofia Rossi', '+13125550123', 'Subaru', 'Outback', 2018, 'AC blowing warm air', 'electrical'],
  ['Marcus Johnson', '+13125550167', 'Nissan', 'Altima', 2015, 'Transmission slipping when shifting', 'transmission'],
  ['Emily Chen', '+13125550133', 'Tesla', 'Model 3', 2022, 'Tire pressure warning on the dash', 'tires'],
  ['Robert Wilson', '+13125550154', 'Jeep', 'Grand Cherokee', 2014, 'Battery keeps dying overnight', 'electrical'],
  ['Hannah Brooks', '+13125550189', 'Volkswagen', 'Jetta', 2020, 'Squeaking from the front left wheel', 'brakes'],
  ['Carlos Mendez', '+13125550101', 'Hyundai', 'Elantra', 2019, 'Coolant leak under the car', 'engine']
];

// Next Thanksgiving (4th Thursday of November) and Christmas, as [start, end, reason] local dates
function upcomingHolidays(now) {
  const out = [];
  for (const year of [now.year, now.year + 1]) {
    const nov1 = DateTime.fromObject({ year, month: 11, day: 1 }, { zone: TZ });
    const thanksgiving = nov1.plus({ days: ((4 - nov1.weekday + 7) % 7) + 21 });
    out.push([thanksgiving, thanksgiving.plus({ days: 1 }), 'Thanksgiving']);
    out.push([DateTime.fromObject({ year, month: 12, day: 24 }, { zone: TZ }), DateTime.fromObject({ year, month: 12, day: 26 }, { zone: TZ }), 'Christmas']);
  }
  return out.filter(([, end]) => end >= now.startOf('day')).slice(0, 2);
}

function transcript(name, car, issue, booked, when) {
  const first = name.split(' ')[0];
  const lines = [
    "Agent: Thanks for calling Riverside Auto Care. I'm the shop's AI assistant, and this call is recorded. How can I help you today?",
    `Caller: Hi, I've got a ${car} and ${issue.charAt(0).toLowerCase()}${issue.slice(1)}.`,
    "Agent: Sorry to hear that. Let's get it looked at. Can I have your name, please?",
    `Caller: It's ${name}.`,
    `Agent: Thanks, ${first}. Is the number you're calling from the best one to reach you?`,
    'Caller: Yes, that works.'
  ];
  if (booked) {
    lines.push(
      `Agent: I have ${when} available. Would that work for you?`,
      "Caller: Perfect, let's do that.",
      `Agent: You're all set for ${when}. You'll get a confirmation shortly. Anything else I can help with?`,
      "Caller: No, that's it. Thanks!"
    );
  } else {
    lines.push(
      'Agent: The earliest I can offer is Thursday at 8 AM. Would that work?',
      "Caller: I can't do Thursday. Can someone call me back about next week?",
      "Agent: Of course. I'll ask the team to call you back today. Have a great day!"
    );
  }
  return lines.join('\n');
}

async function seed(client) {
  const now = DateTime.now().setZone(TZ);
  const holidays = upcomingHolidays(now);
  const closed = (d) => d.weekday === 7 || holidays.some(([s, e]) => d.startOf('day') >= s.startOf('day') && d.startOf('day') <= e.startOf('day'));
  const open = (d) => { let at = d; while (closed(at)) at = at.plus({ days: 1 }); return at; };

  // Replace only the demo shop; ON DELETE CASCADE removes its calls, bookings, users and closures
  await client.query('DELETE FROM workshops WHERE email = $1', [SHOP_EMAIL]);
  const shop = (await client.query(
    `INSERT INTO workshops (name, email, phone, address, timezone, bay_count, slot_minutes, notify_emails, transfer_phone, business_hours)
     VALUES ('Riverside Auto Care', $1, '+13125550100', '1420 River Rd, Springfield, IL 62701', $2, 3, 60, ARRAY['manager@riverside-demo.test'], '+13125550100',
             '{"monday":{"open":"08:00","close":"18:00"},"tuesday":{"open":"08:00","close":"18:00"},"wednesday":{"open":"08:00","close":"18:00"},"thursday":{"open":"08:00","close":"18:00"},"friday":{"open":"08:00","close":"18:00"},"saturday":{"open":"09:00","close":"14:00"},"sunday":{"closed":true}}')
     RETURNING id`,
    [SHOP_EMAIL, TZ]
  )).rows[0].id;

  const customerFor = async (p) => (await client.query(
    `INSERT INTO customers (workshop_id, name, phone, email) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workshop_id, phone) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [shop, p[0], p[1], `${p[0].split(' ')[0].toLowerCase()}@example.com`]
  )).rows[0].id;
  const vehicleFor = async (customer, p) => (await client.query(
    'INSERT INTO vehicles (customer_id, make, model, year) VALUES ($1, $2, $3, $4) RETURNING id', [customer, p[2], p[3], p[4]]
  )).rows[0].id;

  let n = 0;
  const perDay = [2, 3, 4, 3, 5, 2, 1, 4, 3, 5, 4, 3, 2, 4];
  for (let day = 13; day >= 0; day--) {
    for (let k = 0; k < perDay[day]; k++) {
      const p = PEOPLE[n % PEOPLE.length];
      n++;
      const started = now.minus({ days: day }).set({ hour: 9 + ((k * 3 + day) % 8), minute: (k * 17) % 60, second: 0 });
      if (started > now) continue;
      const booked = n % 4 !== 1;
      const callback = !booked && n % 3 !== 0;
      const at = open(started.plus({ days: 2 }).set({ hour: 10 + (k % 5), minute: 0 }));
      const whenText = at.toFormat("cccc 'at' h a");
      const length = 95 + ((n * 37) % 160);
      const call = (await client.query(
        `INSERT INTO calls (workshop_id, from_number, to_number, provider_call_id, status, started_at, answered_at, ended_at, duration_seconds, transcript, ended_reason)
         VALUES ($1, $2, '+13125550100', $3, 'completed', $4, $4, $5, $6, $7, 'customer-ended-call') RETURNING id`,
        [shop, p[1], `demo-${n}`, started.toJSDate(), started.plus({ seconds: length }).toJSDate(), length,
          transcript(p[0], `${p[4]} ${p[2]} ${p[3]}`, p[5], booked, whenText)]
      )).rows[0].id;
      await client.query(
        `INSERT INTO call_analysis (call_id, structured_data, customer_name, customer_phone, vehicle_make, vehicle_model, issue_keywords, sentiment, booking_created, callback_requested)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [call, JSON.stringify({ summary: booked ? `${p[0].split(' ')[0]} called about: ${p[5].toLowerCase()}. Booked for ${whenText}.` : `${p[0].split(' ')[0]} wanted an appointment next week and asked for a call back.` }),
          p[0], p[1], p[2], p[3], p[5], booked ? 'positive' : 'neutral', booked, callback]
      );
      if (booked) {
        const customer = await customerFor(p);
        const status = at < now ? (n % 9 === 0 ? 'no_show' : 'completed') : 'confirmed';
        await client.query(
          `INSERT INTO bookings (workshop_id, customer_id, vehicle_id, call_id, scheduled_at, duration_minutes, issue_summary, issue_category, urgency, status)
           VALUES ($1, $2, $3, $4, $5, 60, $6, $7, $8, $9)`,
          [shop, customer, await vehicleFor(customer, p), call, at.toJSDate(), p[5], p[6], /brak|transmission|coolant/i.test(p[5]) ? 'urgent' : 'normal', status]
        );
      }
    }
  }

  // A few appointments today and over the next days, so "next appointments" is never empty
  for (const [i, [days, hour]] of [[0, 15], [0, 16], [1, 9], [1, 11], [2, 10]].entries()) {
    const at = open(now.plus({ days }).set({ hour, minute: 0, second: 0 }));
    if (at < now) continue;
    const p = PEOPLE[(i + 3) % PEOPLE.length];
    const customer = await customerFor(p);
    await client.query(
      `INSERT INTO bookings (workshop_id, customer_id, vehicle_id, scheduled_at, duration_minutes, issue_summary, issue_category, urgency, status)
       VALUES ($1, $2, $3, $4, 60, $5, $6, 'normal', 'confirmed')`,
      [shop, customer, await vehicleFor(customer, p), at.toJSDate(), p[5], p[6]]
    );
  }
  await client.query(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = 'Customer found a closer shop'
      WHERE id = (SELECT id FROM bookings WHERE workshop_id = $1 AND status = 'confirmed' ORDER BY scheduled_at DESC LIMIT 1)`,
    [shop]
  );
  for (const [start, end, reason] of holidays) {
    await client.query('INSERT INTO closures (workshop_id, starts_on, ends_on, reason) VALUES ($1, $2, $3, $4)', [shop, start.toISODate(), end.toISODate(), reason]);
  }
  return shop;
}

async function main() {
  if (!process.argv.includes('--yes')) {
    throw new Error('This replaces the demo shop "Riverside Auto Care" in the configured database. Re-run with --yes to confirm.');
  }
  if (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 10) {
    throw new Error('Set DEMO_PASSWORD (at least 10 characters) for the demo login.');
  }
  const client = await getClient();
  let shop;
  try {
    await client.query('BEGIN');
    shop = await seed(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await upsertUser({ workshopId: shop, email: LOGIN_EMAIL, password: process.env.DEMO_PASSWORD, fullName: 'Demo Visitor', role: 'staff' });
  const { rows } = await pool.query(
    `SELECT (SELECT COUNT(*) FROM calls WHERE workshop_id = $1)::int AS calls, (SELECT COUNT(*) FROM bookings WHERE workshop_id = $1)::int AS bookings`,
    [shop]
  );
  console.log(`✅ Demo shop ready: ${rows[0].calls} calls, ${rows[0].bookings} bookings. Sign in as ${LOGIN_EMAIL} (staff).`);
}

main()
  .catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
