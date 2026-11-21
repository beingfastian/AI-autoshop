-- Development seed data (moved from database/schema.sql). Safe to re-run.

-- Test workshop
INSERT INTO workshops (name, email, phone, address, timezone) VALUES
('Joe''s Auto Repair', 'joe@joeauto.com', '+1-555-0100', '123 Main St, Anytown, USA', 'America/New_York')
ON CONFLICT (email) DO NOTHING;

-- Test user
INSERT INTO users (workshop_id, email, password_hash, full_name, role)
SELECT
    id,
    'admin@joeauto.com',
    '$2b$10$YourHashedPasswordHere', -- placeholder, replaced when auth lands (Phase 2)
    'Joe Admin',
    'owner'
FROM workshops WHERE email = 'joe@joeauto.com'
ON CONFLICT (email) DO NOTHING;
