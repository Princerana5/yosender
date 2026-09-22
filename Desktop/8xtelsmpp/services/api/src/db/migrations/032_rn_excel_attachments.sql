-- 032_rn_excel_attachments — store the exact xlsx sent with each RN.
CREATE TABLE IF NOT EXISTS rate_notification_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_notification_id UUID NOT NULL REFERENCES rate_notifications(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content BYTEA NOT NULL,
  route_count INT NOT NULL DEFAULT 0,
  country_count INT NOT NULL DEFAULT 0,
  network_count INT NOT NULL DEFAULT 0,
  currency CHAR(3),
  generated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (rate_notification_id)
);
CREATE INDEX IF NOT EXISTS idx_rn_att_parent ON rate_notification_attachments (rate_notification_id);
ALTER TABLE rate_notifications ADD COLUMN IF NOT EXISTS attachment_filename TEXT;
ALTER TABLE rate_notifications ADD COLUMN IF NOT EXISTS attachment_route_count INT DEFAULT 0;
