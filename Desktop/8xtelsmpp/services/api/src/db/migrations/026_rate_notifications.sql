-- 026_rate_notifications — admin-created rate notification emails to clients.
-- No duplicate client records: client_id references clients(id); account_id /
-- system_id are denormalized snapshots of the client row at send time.
CREATE TABLE IF NOT EXISTS rate_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL,            -- snapshot of clients.system_id at send
  system_id TEXT NOT NULL,             -- snapshot of clients.system_id at send
  recipient_email TEXT NOT NULL,
  sender_email TEXT NOT NULL DEFAULT 'rates@8xtel.com',
  subject TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'GMT',
  status TEXT NOT NULL DEFAULT 'draft', -- draft|sending|sent|failed
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_rn_client ON rate_notifications (client_id);
CREATE INDEX IF NOT EXISTS idx_rn_status ON rate_notifications (status);
CREATE INDEX IF NOT EXISTS idx_rn_created ON rate_notifications (created_at DESC);

CREATE TABLE IF NOT EXISTS rate_notification_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_notification_id UUID NOT NULL REFERENCES rate_notifications(id) ON DELETE CASCADE,
  country TEXT NOT NULL,
  country_code CHAR(2),
  network_name TEXT NOT NULL,
  mcc TEXT NOT NULL,
  mnc TEXT NOT NULL,                   -- digits or 'ALL'
  currency CHAR(3) NOT NULL,           -- EUR|USD
  rate NUMERIC(18,6) NOT NULL,         -- exact decimal, no float loss
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rnr_parent ON rate_notification_rates (rate_notification_id);
