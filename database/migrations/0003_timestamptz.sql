-- Up Migration

-- Store every point in time as TIMESTAMPTZ so bookings mean the same instant whatever
-- the server, client or shop timezone. Existing values are interpreted in the session
-- timezone (the DB server default), which is how they were written.

-- The view reads bookings.scheduled_at, so it must be dropped while the type changes
DROP VIEW IF EXISTS booking_stats_daily;

ALTER TABLE workshops
    ALTER COLUMN created_at TYPE TIMESTAMPTZ,
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

ALTER TABLE calls
    ALTER COLUMN started_at TYPE TIMESTAMPTZ,
    ALTER COLUMN ended_at TYPE TIMESTAMPTZ,
    ALTER COLUMN created_at TYPE TIMESTAMPTZ,
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

ALTER TABLE customers
    ALTER COLUMN last_booking_date TYPE TIMESTAMPTZ,
    ALTER COLUMN created_at TYPE TIMESTAMPTZ,
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

ALTER TABLE vehicles
    ALTER COLUMN created_at TYPE TIMESTAMPTZ,
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

ALTER TABLE bookings
    ALTER COLUMN scheduled_at TYPE TIMESTAMPTZ,
    ALTER COLUMN created_at TYPE TIMESTAMPTZ,
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

ALTER TABLE call_analysis
    ALTER COLUMN created_at TYPE TIMESTAMPTZ;

ALTER TABLE users
    ALTER COLUMN last_login_at TYPE TIMESTAMPTZ,
    ALTER COLUMN created_at TYPE TIMESTAMPTZ,
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ;

ALTER TABLE booking_reminders
    ALTER COLUMN sent_at TYPE TIMESTAMPTZ;

-- Daily stats are grouped by the shop's local date, not the DB server's
CREATE VIEW booking_stats_daily AS
SELECT
    b.workshop_id,
    (b.scheduled_at AT TIME ZONE w.timezone)::date AS date,
    COUNT(*) AS total_bookings,
    COUNT(*) FILTER (WHERE b.status = 'confirmed') AS confirmed_bookings,
    COUNT(*) FILTER (WHERE b.status = 'completed') AS completed_bookings,
    COUNT(*) FILTER (WHERE b.urgency = 'urgent') AS urgent_bookings
FROM bookings b
JOIN workshops w ON w.id = b.workshop_id
GROUP BY b.workshop_id, (b.scheduled_at AT TIME ZONE w.timezone)::date;

-- Down Migration

DROP VIEW IF EXISTS booking_stats_daily;

ALTER TABLE booking_reminders
    ALTER COLUMN sent_at TYPE TIMESTAMP;

ALTER TABLE users
    ALTER COLUMN last_login_at TYPE TIMESTAMP,
    ALTER COLUMN created_at TYPE TIMESTAMP,
    ALTER COLUMN updated_at TYPE TIMESTAMP;

ALTER TABLE call_analysis
    ALTER COLUMN created_at TYPE TIMESTAMP;

ALTER TABLE bookings
    ALTER COLUMN scheduled_at TYPE TIMESTAMP,
    ALTER COLUMN created_at TYPE TIMESTAMP,
    ALTER COLUMN updated_at TYPE TIMESTAMP;

ALTER TABLE vehicles
    ALTER COLUMN created_at TYPE TIMESTAMP,
    ALTER COLUMN updated_at TYPE TIMESTAMP;

ALTER TABLE customers
    ALTER COLUMN last_booking_date TYPE TIMESTAMP,
    ALTER COLUMN created_at TYPE TIMESTAMP,
    ALTER COLUMN updated_at TYPE TIMESTAMP;

ALTER TABLE calls
    ALTER COLUMN started_at TYPE TIMESTAMP,
    ALTER COLUMN ended_at TYPE TIMESTAMP,
    ALTER COLUMN created_at TYPE TIMESTAMP,
    ALTER COLUMN updated_at TYPE TIMESTAMP;

ALTER TABLE workshops
    ALTER COLUMN created_at TYPE TIMESTAMP,
    ALTER COLUMN updated_at TYPE TIMESTAMP;

-- Original definition from 0001
CREATE VIEW booking_stats_daily AS
SELECT
    workshop_id,
    DATE(scheduled_at) as date,
    COUNT(*) as total_bookings,
    COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_bookings,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_bookings,
    COUNT(CASE WHEN urgency = 'urgent' THEN 1 END) as urgent_bookings
FROM bookings
GROUP BY workshop_id, DATE(scheduled_at);
