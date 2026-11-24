# Wrenchline

**AI receptionist for auto repair shops.**

AI phone receptionist for auto repair shops. Callers talk to a voice agent; call results are stored in Postgres, turned into bookings, and confirmed by email.

**Launch market: US only.** Every shop must have its own timezone (e.g. `America/New_York`, `America/Chicago`, `America/Denver`, `America/Phoenix`, `America/Los_Angeles`); there is no default, because a wrong one shifts every slot and reminder by hours. Times are shown in US format, and phone numbers without a country code are read as US numbers.

## Repository layout

```
server/             One package, two processes:
  src/app.js        Express app: Vapi calls and webhooks, bookings and email notifications
  src/server.js     API process (port 3001)
  src/worker.js     Background process: scheduled jobs (hourly reminders)
database/
  migrations/       SQL migrations, applied in filename order (node-pg-migrate)
  seed.sql          Development seed data (idempotent)
scripts/            Migration, seed and test-database helpers
Architecture/       Architecture diagram (draw.io + SVG)
```

## Prerequisites

- Node.js 20.19+ or 22.12+ (the services themselves run on 18+; the migration tooling loads an ES-module-only package via `require()`, which needs those versions)
- PostgreSQL 14+, either a local install or `docker compose up -d` (Postgres on port **5433**)

## Setup

```bash
npm run install:all                               # root tooling + server

cp server/.env.example server/.env
# fill in DB_* and API keys

npm run db:migrate                                # create / update the schema
npm run db:seed                                   # optional test workshop + user
```

Root scripts read `DB_*` from a root `.env` if present, otherwise from `server/.env`. `DATABASE_URL` takes precedence if set.

**Existing database created from the old `schema.sql`?** Mark the initial migration as applied, then run the rest:

```bash
npm run db:migrate -- --fake --count 1
npm run db:migrate
```

## Running

```bash
npm --prefix server run dev            # API
npm --prefix server run dev:worker     # background jobs (separate terminal)
```

In production use `npm --prefix server start` and `npm --prefix server run worker`. **The worker must be running**: the API only queues confirmation emails, SMS and reminders, and the worker sends them (within about 5 seconds). Several workers are safe; they never send the same message twice.

`/health` includes `notifications_overdue`: messages more than 5 minutes late. Anything above 0 means the worker is down or stuck, so alert on it.

### Notifications

Every email/SMS is a row in the `notifications` table (an outbox), written in the same transaction as the booking, so a failed booking never sends anything. The worker:
- sends due rows and records the provider's message id;
- retries temporary failures after 1, 5, 15 and 60 minutes, and marks a message `failed` after 5 attempts or straight away on a permanent error (e.g. invalid address);
- skips messages for cancelled bookings and reminders for appointments that have already started;
- queues reminders 24h and 2h before each confirmed appointment (no 24h reminder for bookings made less than a day ahead).

SMS is off unless `ENABLE_SMS=true` (see `server/.env.example`).

Health check: `GET http://localhost:3001/health`.

## Dashboard logins

Shop staff sign in with email and password (`POST /api/auth/login`). A signed-in user only ever sees and changes **their own shop's** calls, bookings and settings; another shop's ids answer 404. Owners can change settings, staff can view them. The `API_KEY` header (`x-api-key`) is an **admin key** with access to every shop, for scripts only.

Create a login, or reset a password:
```bash
npm --prefix server run user:create -- --shop joe@joeauto.com --email owner@joeauto.com --name "Joe Smith"
```
Without `NEW_USER_PASSWORD` set, a random password is generated and shown once. Passwords are hashed with scrypt; 5 wrong attempts lock the account for 15 minutes; sessions last 14 days and end on logout or password reset.

## Shop dashboard (Next.js)

`web/` is the shop dashboard: overview (next appointments, callers waiting for a call back), calls with transcripts, bookings (complete, no-show, cancel) and settings (opening hours, closed days, bays, appointment length, contacts). All times are shown in the shop's timezone.

```bash
npm --prefix server run dev      # API on :3001
npm --prefix web run dev         # dashboard on http://localhost:3000
```

Sign in with a login made by `user:create` (above). The dashboard forwards `/api/*` to the API (`API_URL`, default `http://localhost:3001`), so the browser only talks to one site and the session cookie stays first-party.

## Voice agent (LiveKit)

`agent/` answers the phone. For building and demos it uses free tiers: **LiveKit Cloud** (call handling, one free US number), **Deepgram** (speech to text and voice) and **Groq** (the LLM). All receptionist logic lives in the server; the agent calls `/api/voice` on every call, so the voice provider can be swapped later without touching it.

1. `cp agent/.env.example agent/.env` and fill in the keys. `VOICE_AGENT_KEY` must equal the one in `server/.env`.
2. Give a test shop the AI number used by browser test calls (`DEMO_SHOP_NUMBER`):
   `UPDATE workshops SET ai_phone_number = '+15551112222' WHERE email = 'joe@joeauto.com';`
3. Start the API, the worker and the agent, each in its own terminal:
   ```bash
   npm --prefix server run dev
   npm --prefix server run dev:worker
   npm --prefix agent run dev
   ```
4. **Browser test call:** open https://agents-playground.livekit.io, connect to your LiveKit project and talk.
5. **Phone test call:** in LiveKit Cloud, claim the free US number (Telephony) and add an inbound dispatch rule. Then set the shop's `ai_phone_number` to that number.

Free tiers are for building and demos with test data only. Real customer calls need paid plans with data-processing agreements.

## Tests and lint

```bash
npm run lint
npm test
```

Tests run against a separate database, `ai_receptionist_test` (override with `TEST_DB_NAME`; the name must end in `_test`). It is dropped and rebuilt from the migrations at the start of every run. Your dev database is never touched. External services are stubbed: SendGrid is mocked in every test file that can send email. Tests run with `TZ=UTC`, like a production server.

Tests in a `known bugs` block use `test.failing`: they describe correct behaviour that is broken today and pass only while the bug exists. When a fix lands, Jest reports the test as failing ("unexpectedly passed"); change it to a normal `test()`.

CI (`.github/workflows/ci.yml`) runs lint and tests on every pull request.

## Database migrations

- New migration: add `database/migrations/NNNN_description.sql` with `-- Up Migration` and `-- Down Migration` sections.
- `npm run db:migrate` applies pending migrations; `npm run db:migrate:down` rolls back the latest one.
- Never edit a migration that has already been applied anywhere. Add a new one instead.
- `npm run test:migrations` (part of `npm test` and CI) applies, rolls back and re-applies every migration on a throwaway `_test` database, checks the schema is restored exactly, and checks that data written under the original schema survives.

## Environment variables

See `server/.env.example`. The API and worker check their configuration at startup and exit with a list of anything missing or invalid. Required: `API_KEY`, `VAPI_WEBHOOK_SECRET`, `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`.

`/api/calls` and `/api/bookings` require the `x-api-key` header (an interim measure until real accounts exist). Vapi webhooks authenticate with `VAPI_WEBHOOK_SECRET` instead, and `/health` is public. `.env` files are git-ignored; never commit real secrets.
