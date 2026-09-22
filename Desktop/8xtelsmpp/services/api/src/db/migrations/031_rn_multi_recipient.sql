-- 031_rn_multi_recipient — stats/export/resend/copy/delete support for RN.
-- Contacts table already exists from 030; add case-insensitive uniqueness guard
-- (emails are stored lowercased by the API) and a status index for stats.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rn_contacts_email_lower
  ON rate_notification_email_contacts (lower(email));
CREATE INDEX IF NOT EXISTS idx_rn_created_status ON rate_notifications (created_at DESC, status);
CREATE INDEX IF NOT EXISTS idx_rn_account ON rate_notifications (account_id);
CREATE INDEX IF NOT EXISTS idx_rn_system ON rate_notifications (system_id);
CREATE INDEX IF NOT EXISTS idx_rn_recip_email ON rate_notification_recipients (email);
-- Draft copies (Copy Notification action) reuse the same table.
-- No DDL needed: status already supports 'draft'.
