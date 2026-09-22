-- 028_client_rate_email — dedicated recipient for Rate Notifications.
-- portal_email stays the portal login; rate_email is where RN mails go.
-- Falls back to portal_email when unset.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS rate_email TEXT;
