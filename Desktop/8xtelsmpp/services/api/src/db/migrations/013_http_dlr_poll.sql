-- 013_http_dlr_poll — pull-style DLR polling for HTTP vendors.
-- ADDITIVE ONLY: vendors that only offer a status-poll URL (e.g. SamparkHub
-- http-dlr.php?msgid=X) get polled by vendor-worker; webhook + SMPP paths untouched.
ALTER TABLE vendor_http_configs ADD COLUMN IF NOT EXISTS dlr_poll_url_template TEXT;
ALTER TABLE vendor_http_configs ADD COLUMN IF NOT EXISTS dlr_poll_interval_sec INT DEFAULT 30;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS last_dlr_poll_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_messages_dlr_poll
  ON messages (vendor_id, status, last_dlr_poll_at) WHERE status = 'submitted';
