-- Up Migration

-- The voice agent is no longer tied to Vapi (LiveKit for now, swappable later), so the
-- columns get provider-neutral names.
ALTER TABLE workshops RENAME COLUMN vapi_phone_number TO ai_phone_number;
ALTER TABLE calls RENAME COLUMN vapi_call_id TO provider_call_id;
ALTER TABLE calls RENAME CONSTRAINT calls_vapi_call_id_key TO calls_provider_call_id_key;
ALTER INDEX idx_calls_vapi RENAME TO idx_calls_provider_call;

-- Never read by any code; assistants are built per call by our API
ALTER TABLE workshops DROP COLUMN vapi_assistant_id;

-- A number can only belong to one shop, or it would be random which shop answers
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM workshops WHERE ai_phone_number IS NOT NULL
        GROUP BY ai_phone_number HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Several workshops share the same ai_phone_number. Give each its own number, then rerun. Find them with: SELECT ai_phone_number, COUNT(*) FROM workshops GROUP BY 1 HAVING COUNT(*) > 1';
    END IF;
END $$;
CREATE UNIQUE INDEX workshops_ai_phone_number_unique ON workshops(ai_phone_number) WHERE ai_phone_number IS NOT NULL;

-- Notifications about a call rather than a booking: "this caller needs a call back"
ALTER TABLE notifications ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE notifications ADD COLUMN call_id UUID REFERENCES calls(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT notifications_subject_check
    CHECK ((booking_id IS NOT NULL) <> (call_id IS NOT NULL));
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'booking_confirmation_customer',
    'booking_notification_workshop',
    'reminder_24h',
    'reminder_2h',
    'booking_cancelled',
    'callback_requested'
));
CREATE UNIQUE INDEX notifications_call_unique ON notifications(call_id, kind, channel, recipient)
    WHERE call_id IS NOT NULL;
CREATE INDEX idx_notifications_call ON notifications(call_id) WHERE call_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS idx_notifications_call;
DROP INDEX IF EXISTS notifications_call_unique;
DELETE FROM notifications WHERE call_id IS NOT NULL;
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'booking_confirmation_customer',
    'booking_notification_workshop',
    'reminder_24h',
    'reminder_2h',
    'booking_cancelled'
));
ALTER TABLE notifications DROP CONSTRAINT notifications_subject_check;
ALTER TABLE notifications DROP COLUMN call_id;
ALTER TABLE notifications ALTER COLUMN booking_id SET NOT NULL;

DROP INDEX IF EXISTS workshops_ai_phone_number_unique;
ALTER TABLE workshops ADD COLUMN vapi_assistant_id VARCHAR(100);

ALTER INDEX idx_calls_provider_call RENAME TO idx_calls_vapi;
ALTER TABLE calls RENAME CONSTRAINT calls_provider_call_id_key TO calls_vapi_call_id_key;
ALTER TABLE calls RENAME COLUMN provider_call_id TO vapi_call_id;
ALTER TABLE workshops RENAME COLUMN ai_phone_number TO vapi_phone_number;
