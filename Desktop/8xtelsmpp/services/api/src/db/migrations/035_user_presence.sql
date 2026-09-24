-- 035_user_presence — last_seen heartbeat for active/offline presence (§30)
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON users (last_seen_at);
-- backfill from last_login_at so existing users have a value
UPDATE users SET last_seen_at = COALESCE(last_seen_at, last_login_at) WHERE last_seen_at IS NULL AND last_login_at IS NOT NULL;
