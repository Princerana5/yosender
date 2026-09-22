-- 030_rn_recipients_contacts — TO/CC/BCC recipients + saved contacts.
ALTER TABLE rate_notification_rates ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS rate_notification_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_notification_id UUID NOT NULL REFERENCES rate_notifications(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  recipient_type TEXT NOT NULL,          -- TO|CC|BCC
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rnr_recip_parent ON rate_notification_recipients (rate_notification_id);

-- Backfill: existing notifications get their single recipient as TO.
INSERT INTO rate_notification_recipients (rate_notification_id, email, recipient_type)
SELECT id, recipient_email, 'TO' FROM rate_notifications
WHERE NOT EXISTS (SELECT 1 FROM rate_notification_recipients r WHERE r.rate_notification_id = rate_notifications.id);

CREATE TABLE IF NOT EXISTS rate_notification_email_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  is_default_cc BOOLEAN DEFAULT false,
  is_default_bcc BOOLEAN DEFAULT false,
  active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
