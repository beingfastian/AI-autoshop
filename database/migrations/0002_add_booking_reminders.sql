-- Moved unchanged from database/migrations/001_add_booking_reminders.sql

-- Up Migration

-- Migration: Add booking_reminders table
-- This table tracks which reminder emails have been sent

CREATE TABLE IF NOT EXISTS booking_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    reminder_type VARCHAR(10) NOT NULL, -- '24h', '2h'
    sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Prevent duplicate reminders
    UNIQUE(booking_id, reminder_type)
);

CREATE INDEX idx_booking_reminders_booking ON booking_reminders(booking_id);
CREATE INDEX idx_booking_reminders_type ON booking_reminders(reminder_type);
CREATE INDEX idx_booking_reminders_sent ON booking_reminders(sent_at DESC);

-- Down Migration

DROP TABLE IF EXISTS booking_reminders;
