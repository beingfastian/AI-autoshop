-- Up Migration

-- Launch market is the US, which spans six timezones (most with daylight saving). Any default
-- would be wrong for most shops, and a wrong timezone shifts every slot and reminder by hours,
-- so each shop must now state its own (e.g. America/New_York, America/Chicago,
-- America/Denver, America/Phoenix, America/Los_Angeles). Existing shops keep theirs.
ALTER TABLE workshops ALTER COLUMN timezone DROP DEFAULT;

-- Clear messages for shop staff, with US examples
CREATE OR REPLACE FUNCTION validate_workshop_timezone()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.timezone IS NULL THEN
        RAISE EXCEPTION 'Every workshop needs a timezone, such as America/New_York or America/Los_Angeles.'
            USING ERRCODE = 'not_null_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
        RAISE EXCEPTION 'Unknown timezone "%". Use an IANA name such as America/New_York.', NEW.timezone
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Down Migration

-- Function as defined in 0005
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

ALTER TABLE workshops ALTER COLUMN timezone SET DEFAULT 'Asia/Karachi';
