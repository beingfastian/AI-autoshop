-- Up Migration

-- Columns the code already uses (call-started webhook, booking cancellation) or needs
-- for real calls, plus constraints on values the code controls.

ALTER TABLE calls
    ADD COLUMN answered_at TIMESTAMPTZ,
    ADD COLUMN ended_reason VARCHAR(100);

ALTER TABLE bookings
    ADD COLUMN cancelled_at TIMESTAMPTZ,
    ADD COLUMN cancellation_reason TEXT;

ALTER TABLE vehicles
    ADD COLUMN mileage INTEGER CHECK (mileage >= 0),
    ADD COLUMN vin VARCHAR(17);

ALTER TABLE call_analysis
    ADD COLUMN callback_requested BOOLEAN NOT NULL DEFAULT false;

-- Status values are set by our code only. urgency and issue_category come from the AI
-- and are normalized in code instead, so a surprising value can't fail a whole call.
ALTER TABLE bookings
    ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show'));

ALTER TABLE calls
    ADD CONSTRAINT calls_status_check
    CHECK (status IN ('initiated', 'in-progress', 'completed', 'failed'));

ALTER TABLE bookings
    ADD CONSTRAINT bookings_cancellation_check
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
    NOT VALID; -- rows cancelled before this column existed have no timestamp

-- One booking per call: Vapi retries webhooks, and a retry must not book twice
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM bookings WHERE call_id IS NOT NULL
        GROUP BY call_id HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'bookings has several rows for the same call_id. Cancel or merge the duplicates, then rerun this migration. Find them with: SELECT call_id, COUNT(*) FROM bookings WHERE call_id IS NOT NULL GROUP BY call_id HAVING COUNT(*) > 1';
    END IF;
END $$;

CREATE UNIQUE INDEX bookings_call_id_unique ON bookings(call_id) WHERE call_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS bookings_call_id_unique;

ALTER TABLE bookings
    DROP CONSTRAINT IF EXISTS bookings_cancellation_check,
    DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE calls
    DROP CONSTRAINT IF EXISTS calls_status_check;

ALTER TABLE call_analysis
    DROP COLUMN IF EXISTS callback_requested;

ALTER TABLE vehicles
    DROP COLUMN IF EXISTS vin,
    DROP COLUMN IF EXISTS mileage;

ALTER TABLE bookings
    DROP COLUMN IF EXISTS cancellation_reason,
    DROP COLUMN IF EXISTS cancelled_at;

ALTER TABLE calls
    DROP COLUMN IF EXISTS ended_reason,
    DROP COLUMN IF EXISTS answered_at;
