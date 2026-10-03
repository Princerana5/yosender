ALTER TABLE rcs_campaign_recipients
  DROP CONSTRAINT IF EXISTS rcs_campaign_recipients_campaign_id_destination_key;

CREATE TABLE IF NOT EXISTS rcs_usage_limit_events (
  event_key TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('client','route','vendor')),
  scope_id UUID NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('day','month')),
  period_start DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rcs_usage_limit_events_scope
  ON rcs_usage_limit_events(scope_type, scope_id, period_type, period_start);
