-- Up Migration

-- Sending moves to the notifications outbox (step 1.7). Before the old tracking goes,
-- its history is copied over, so nothing already sent is lost or sent again.

-- Confirmations already sent to customers
INSERT INTO notifications (booking_id, channel, kind, recipient, status, attempts, sent_at)
SELECT b.id, 'email', 'booking_confirmation_customer', lower(c.email), 'sent', 1, b.updated_at
  FROM bookings b JOIN customers c ON c.id = b.customer_id
 WHERE b.customer_email_sent AND c.email IS NOT NULL
ON CONFLICT DO NOTHING;

-- Alerts already sent to shops
INSERT INTO notifications (booking_id, channel, kind, recipient, status, attempts, sent_at)
SELECT b.id, 'email', 'booking_notification_workshop', lower(w.email), 'sent', 1, b.updated_at
  FROM bookings b JOIN workshops w ON w.id = b.workshop_id
 WHERE b.workshop_email_sent
ON CONFLICT DO NOTHING;

-- Reminders already sent
INSERT INTO notifications (booking_id, channel, kind, recipient, status, attempts, sent_at)
SELECT r.booking_id, 'email', 'reminder_' || r.reminder_type, lower(c.email), 'sent', 1, r.sent_at
  FROM booking_reminders r
  JOIN bookings b ON b.id = r.booking_id
  JOIN customers c ON c.id = b.customer_id
 WHERE r.reminder_type IN ('24h', '2h') AND c.email IS NOT NULL
ON CONFLICT DO NOTHING;

DROP TABLE booking_reminders;

ALTER TABLE bookings
    DROP COLUMN customer_email_sent,
    DROP COLUMN workshop_email_sent;

-- Down Migration

ALTER TABLE bookings
    ADD COLUMN customer_email_sent BOOLEAN DEFAULT false,
    ADD COLUMN workshop_email_sent BOOLEAN DEFAULT false;

UPDATE bookings b SET
    customer_email_sent = EXISTS (
        SELECT 1 FROM notifications n
         WHERE n.booking_id = b.id AND n.kind = 'booking_confirmation_customer'
           AND n.channel = 'email' AND n.status = 'sent'),
    workshop_email_sent = EXISTS (
        SELECT 1 FROM notifications n
         WHERE n.booking_id = b.id AND n.kind = 'booking_notification_workshop'
           AND n.channel = 'email' AND n.status = 'sent');

-- Same definition as 0002 (+ TIMESTAMPTZ from 0003)
CREATE TABLE booking_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    reminder_type VARCHAR(10) NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(booking_id, reminder_type)
);

CREATE INDEX idx_booking_reminders_booking ON booking_reminders(booking_id);
CREATE INDEX idx_booking_reminders_type ON booking_reminders(reminder_type);
CREATE INDEX idx_booking_reminders_sent ON booking_reminders(sent_at DESC);

INSERT INTO booking_reminders (booking_id, reminder_type, sent_at)
SELECT booking_id, replace(kind, 'reminder_', ''), MIN(sent_at)
  FROM notifications
 WHERE kind IN ('reminder_24h', 'reminder_2h') AND channel = 'email' AND status = 'sent'
 GROUP BY booking_id, kind;
