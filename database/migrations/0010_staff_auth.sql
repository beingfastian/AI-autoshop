-- Up Migration

-- Shop staff log in to the dashboard. Each user belongs to one workshop and only ever sees its data.

-- Login protection: after repeated wrong passwords the account is locked for a while.
-- Stored in the DB so it holds across every server instance (serverless runs many).
ALTER TABLE users
    ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN locked_until TIMESTAMPTZ;

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'staff', 'admin'));
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled'));

-- Emails are compared case-insensitively: Joe@Shop.com and joe@shop.com are one account
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM users GROUP BY lower(email) HAVING COUNT(*) > 1) THEN
        RAISE EXCEPTION 'users has emails that differ only by letter case. Merge or rename them, then rerun. Find them with: SELECT lower(email), COUNT(*) FROM users GROUP BY 1 HAVING COUNT(*) > 1';
    END IF;
END $$;
CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email));

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Login sessions. Only a hash of the cookie token is stored, so a database leak can't be used to log in.
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent VARCHAR(255),
    CHECK (expires_at > created_at)
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Down Migration

DROP TABLE IF EXISTS sessions;
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
DROP INDEX IF EXISTS users_email_lower_unique;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
    DROP COLUMN IF EXISTS locked_until,
    DROP COLUMN IF EXISTS failed_login_count;
