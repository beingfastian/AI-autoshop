-- Up Migration

-- Data the scheduler needs to offer real slots: slot length, capacity, notice period,
-- holidays and the services a shop offers.

ALTER TABLE workshops
    ADD COLUMN slot_minutes INTEGER NOT NULL DEFAULT 60
        CHECK (slot_minutes BETWEEN 15 AND 480),
    ADD COLUMN bay_count INTEGER NOT NULL DEFAULT 2
        CHECK (bay_count BETWEEN 1 AND 100),
    ADD COLUMN min_notice_minutes INTEGER NOT NULL DEFAULT 60
        CHECK (min_notice_minutes BETWEEN 0 AND 10080),
    ADD COLUMN transfer_phone VARCHAR(20),
    ADD COLUMN notify_emails TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN notify_sms TEXT[] NOT NULL DEFAULT '{}';

-- Launch market is Pakistan; existing shops keep the timezone they have
ALTER TABLE workshops ALTER COLUMN timezone SET DEFAULT 'Asia/Karachi';
UPDATE workshops SET timezone = 'Asia/Karachi' WHERE timezone IS NULL;
ALTER TABLE workshops ALTER COLUMN timezone SET NOT NULL;

-- A typo like 'Asia/Karachy' would break every slot calculation for that shop,
-- so reject unknown timezone names when they are written
CREATE OR REPLACE FUNCTION validate_workshop_timezone()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
        RAISE EXCEPTION 'Unknown timezone "%". Use an IANA name such as Asia/Karachi.', NEW.timezone
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workshops_validate_timezone
BEFORE INSERT OR UPDATE OF timezone ON workshops
FOR EACH ROW EXECUTE FUNCTION validate_workshop_timezone();

-- Whole days a shop is closed (public holidays, Eid, maintenance), in the shop's local dates
CREATE TABLE closures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workshop_id UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    reason VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_on >= starts_on)
);

CREATE INDEX idx_closures_workshop_dates ON closures(workshop_id, starts_on, ends_on);

-- Services a shop offers; duration decides how many slots a booking takes
CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workshop_id UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'other'
        CHECK (category IN ('brakes', 'engine', 'transmission', 'electrical', 'tires', 'other')),
    duration_minutes INTEGER NOT NULL DEFAULT 60
        CHECK (duration_minutes BETWEEN 15 AND 1440),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workshop_id, name)
);

CREATE INDEX idx_services_workshop ON services(workshop_id) WHERE active;

CREATE TRIGGER update_services_updated_at BEFORE UPDATE ON services
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Down Migration

DROP TABLE IF EXISTS services;
DROP TABLE IF EXISTS closures;

DROP TRIGGER IF EXISTS workshops_validate_timezone ON workshops;
DROP FUNCTION IF EXISTS validate_workshop_timezone();

ALTER TABLE workshops ALTER COLUMN timezone DROP NOT NULL;
ALTER TABLE workshops ALTER COLUMN timezone SET DEFAULT 'America/New_York';

ALTER TABLE workshops
    DROP COLUMN IF EXISTS notify_sms,
    DROP COLUMN IF EXISTS notify_emails,
    DROP COLUMN IF EXISTS transfer_phone,
    DROP COLUMN IF EXISTS min_notice_minutes,
    DROP COLUMN IF EXISTS bay_count,
    DROP COLUMN IF EXISTS slot_minutes;
