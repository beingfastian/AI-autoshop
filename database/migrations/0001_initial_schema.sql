-- Initial schema, moved unchanged from database/schema.sql (seed data now lives in database/seed.sql).

-- Up Migration

-- ============================================
-- AI RECEPTIONIST MVP - DATABASE SCHEMA
-- ============================================
-- PostgreSQL 14+
-- Simplified schema with essential tables only

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search

-- ============================================
-- 1. WORKSHOPS (Core tenant table)
-- ============================================
CREATE TABLE workshops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    address TEXT,
    timezone VARCHAR(50) DEFAULT 'America/New_York',
    
    -- Business hours (simple JSON)
    business_hours JSONB DEFAULT '{
        "monday": {"open": "08:00", "close": "18:00"},
        "tuesday": {"open": "08:00", "close": "18:00"},
        "wednesday": {"open": "08:00", "close": "18:00"},
        "thursday": {"open": "08:00", "close": "18:00"},
        "friday": {"open": "08:00", "close": "18:00"},
        "saturday": {"open": "09:00", "close": "14:00"},
        "sunday": {"closed": true}
    }',
    
    -- Status
    status VARCHAR(20) DEFAULT 'active', -- active, suspended
    
    -- AI Config
    vapi_phone_number VARCHAR(20),
    vapi_assistant_id VARCHAR(100),
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_workshops_status ON workshops(status);
CREATE INDEX idx_workshops_email ON workshops(email);

-- ============================================
-- 2. CALLS (Every incoming call)
-- ============================================
CREATE TABLE calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workshop_id UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
    
    -- Call info
    from_number VARCHAR(20) NOT NULL,
    to_number VARCHAR(20) NOT NULL,
    
    -- Vapi data
    vapi_call_id VARCHAR(100) UNIQUE,
    
    -- Status
    status VARCHAR(20) DEFAULT 'initiated', -- initiated, completed, failed
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMP,
    duration_seconds INTEGER,
    
    -- Recording
    recording_url TEXT,
    transcript TEXT,
    
    -- Cost tracking
    cost_usd DECIMAL(10, 4) DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_calls_workshop ON calls(workshop_id);
CREATE INDEX idx_calls_status ON calls(status);
CREATE INDEX idx_calls_started ON calls(started_at DESC);
CREATE INDEX idx_calls_vapi ON calls(vapi_call_id);

-- ============================================
-- 3. CUSTOMERS (Call participants)
-- ============================================
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workshop_id UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
    
    -- Contact info
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    
    -- Stats
    total_bookings INTEGER DEFAULT 0,
    last_booking_date TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- One customer per phone per workshop
    UNIQUE(workshop_id, phone)
);

CREATE INDEX idx_customers_workshop ON customers(workshop_id);
CREATE INDEX idx_customers_phone ON customers(phone);

-- ============================================
-- 4. VEHICLES (Customer vehicles)
-- ============================================
CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    
    -- Vehicle details
    make VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    year INTEGER,
    variant VARCHAR(100),
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_vehicles_customer ON vehicles(customer_id);

-- ============================================
-- 5. BOOKINGS (The money maker!)
-- ============================================
CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workshop_id UUID NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id),
    vehicle_id UUID REFERENCES vehicles(id),
    call_id UUID REFERENCES calls(id),
    
    -- Appointment
    scheduled_at TIMESTAMP NOT NULL,
    duration_minutes INTEGER DEFAULT 60,
    
    -- Issue
    issue_summary TEXT NOT NULL,
    issue_category VARCHAR(50) DEFAULT 'other',
    urgency VARCHAR(20) DEFAULT 'normal', -- urgent, normal, low
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending', -- pending, confirmed, completed, cancelled
    
    -- Notifications
    customer_email_sent BOOLEAN DEFAULT false,
    workshop_email_sent BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bookings_workshop ON bookings(workshop_id);
CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_bookings_scheduled ON bookings(scheduled_at);
CREATE INDEX idx_bookings_status ON bookings(status);

-- ============================================
-- 6. CALL ANALYSIS (Extracted AI data)
-- ============================================
CREATE TABLE call_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID UNIQUE NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    
    -- Raw structured data from Vapi
    structured_data JSONB NOT NULL,
    
    -- Parsed fields for quick queries
    customer_name VARCHAR(255),
    customer_phone VARCHAR(20),
    vehicle_make VARCHAR(100),
    vehicle_model VARCHAR(100),
    issue_keywords TEXT,
    
    -- Sentiment
    sentiment VARCHAR(20) DEFAULT 'neutral',
    
    -- Success flag
    booking_created BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_call_analysis_call ON call_analysis(call_id);

-- ============================================
-- 7. USERS (Workshop staff/admins)
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workshop_id UUID REFERENCES workshops(id) ON DELETE CASCADE,
    
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'staff', -- owner, staff, admin
    
    status VARCHAR(20) DEFAULT 'active',
    last_login_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_workshop ON users(workshop_id);
CREATE INDEX idx_users_email ON users(email);

-- ============================================
-- TRIGGERS FOR AUTO-UPDATES
-- ============================================

-- Update customer booking count
CREATE OR REPLACE FUNCTION update_customer_bookings()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE customers 
    SET 
        total_bookings = total_bookings + 1,
        last_booking_date = NEW.created_at,
        updated_at = NOW()
    WHERE id = NEW.customer_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_customer_bookings
AFTER INSERT ON bookings
FOR EACH ROW
EXECUTE FUNCTION update_customer_bookings();

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_workshops_updated_at BEFORE UPDATE ON workshops
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_calls_updated_at BEFORE UPDATE ON calls
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================
-- ANALYTICS VIEWS
-- ============================================

-- Daily booking stats per workshop
CREATE OR REPLACE VIEW booking_stats_daily AS
SELECT 
    workshop_id,
    DATE(scheduled_at) as date,
    COUNT(*) as total_bookings,
    COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_bookings,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_bookings,
    COUNT(CASE WHEN urgency = 'urgent' THEN 1 END) as urgent_bookings
FROM bookings
GROUP BY workshop_id, DATE(scheduled_at);

-- Call to booking conversion rate
CREATE OR REPLACE VIEW conversion_stats AS
SELECT 
    w.id as workshop_id,
    w.name as workshop_name,
    COUNT(DISTINCT c.id) as total_calls,
    COUNT(DISTINCT b.id) as total_bookings,
    ROUND(
        (COUNT(DISTINCT b.id)::DECIMAL / NULLIF(COUNT(DISTINCT c.id), 0)) * 100, 
        2
    ) as conversion_rate
FROM workshops w
LEFT JOIN calls c ON c.workshop_id = w.id
LEFT JOIN bookings b ON b.call_id = c.id
GROUP BY w.id, w.name;

-- Down Migration

DROP VIEW IF EXISTS conversion_stats;
DROP VIEW IF EXISTS booking_stats_daily;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS call_analysis;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS calls;
DROP TABLE IF EXISTS workshops;
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS update_customer_bookings();
