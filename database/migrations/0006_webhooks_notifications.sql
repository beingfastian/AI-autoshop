-- Up Migration

-- Every incoming webhook is stored before it is processed. The dedupe key makes Vapi's
-- retries harmless, and failed events keep their payload so they can be replayed.
CREATE TABLE webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(30) NOT NULL DEFAULT 'vapi',
    event_type VARCHAR(100) NOT NULL,
    dedupe_key VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    UNIQUE (provider, dedupe_key)
);

CREATE INDEX idx_webhook_events_unprocessed ON webhook_events(received_at)
    WHERE status IN ('received', 'failed');

-- One row per message we intend to send. The unique key stops the same confirmation
-- or reminder going out twice, even if a job runs twice.
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    channel VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'sms')),
    kind VARCHAR(40) NOT NULL CHECK (kind IN (
        'booking_confirmation_customer',
        'booking_notification_workshop',
        'reminder_24h',
        'reminder_2h',
        'booking_cancelled'
    )),
    recipient VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    provider_message_id VARCHAR(255),
    send_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (booking_id, kind, channel, recipient),
    CHECK (status <> 'sent' OR sent_at IS NOT NULL)
);

CREATE INDEX idx_notifications_due ON notifications(send_after) WHERE status = 'pending';
CREATE INDEX idx_notifications_booking ON notifications(booking_id);

CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- The customer_email_sent/workshop_email_sent flags and booking_reminders are still used
-- by the current code. They are removed in step 1.7, when sending moves to this table.

-- Down Migration

DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS webhook_events;
