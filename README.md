# AI Autoshop Receptionist

AI phone receptionist for auto repair shops. Callers talk to a Vapi voice agent; call results are stored in Postgres, turned into bookings, and confirmed by email.

## Repository layout

```
voice-service/      Express API: Vapi call handling and webhooks (port 3001)
booking-service/    Express API: bookings, email notifications, reminder cron (port 3002)
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
npm run install:all                               # root tooling + both services

cp voice-service/.env.example voice-service/.env
cp booking-service/.env.example booking-service/.env
# fill in DB_* (and API keys) in both files

npm run db:migrate                                # create / update the schema
npm run db:seed                                   # optional test workshop + user
```

Root scripts read `DB_*` from a root `.env` if present, otherwise from `voice-service/.env`. `DATABASE_URL` takes precedence if set.

**Existing database created from the old `schema.sql`?** Mark the initial migration as applied, then run the rest:

```bash
npm run db:migrate -- --fake --count 1
npm run db:migrate
```

## Running

```bash
npm --prefix voice-service run dev
npm --prefix booking-service run dev
```

Health checks: `GET http://localhost:3001/health`, `GET http://localhost:3002/health`.

## Tests and lint

```bash
npm run lint
npm test
```

Tests run against a separate database, `ai_receptionist_test` (override with `TEST_DB_NAME`; the name must end in `_test`). It is dropped and rebuilt from the migrations at the start of every run. Your dev database is never touched. External services are stubbed: SendGrid is mocked and the voice service's call to the booking service points at a closed port.

Tests in a `known bugs` block use `test.failing`: they describe correct behaviour that is broken today and pass only while the bug exists. When a fix lands, Jest reports the test as failing ("unexpectedly passed"); change it to a normal `test()`.

CI (`.github/workflows/ci.yml`) runs lint and tests on every pull request.

## Database migrations

- New migration: add `database/migrations/NNNN_description.sql` with `-- Up Migration` and `-- Down Migration` sections.
- `npm run db:migrate` applies pending migrations; `npm run db:migrate:down` rolls back the latest one.
- Never edit a migration that has already been applied anywhere. Add a new one instead.

## Environment variables

See `voice-service/.env.example` and `booking-service/.env.example`. `.env` files are git-ignored; never commit real secrets.
