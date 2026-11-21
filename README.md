# AI Autoshop Receptionist

AI phone receptionist for auto repair shops. Callers talk to a Vapi voice agent; call results are stored in Postgres, turned into bookings, and confirmed by email.

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

In production use `npm --prefix server start` and `npm --prefix server run worker`. Run exactly one worker so scheduled jobs don't fire twice.

Health check: `GET http://localhost:3001/health`.

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
