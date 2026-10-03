CREATE TABLE IF NOT EXISTS rcs_client_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  label TEXT,
  permissions JSONB NOT NULL DEFAULT '["send","status","balance","campaigns"]'::jsonb,
  ip_allowlist CIDR[] NOT NULL DEFAULT ARRAY[]::CIDR[],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rcs_api_keys_client ON rcs_client_api_keys(client_id);
CREATE TABLE IF NOT EXISTS rcs_usage_counters (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('client','route','vendor')),
  scope_id UUID NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('day','month')),
  period_start DATE NOT NULL,
  submissions BIGINT NOT NULL DEFAULT 0 CHECK (submissions >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(scope_type, scope_id, period_type, period_start)
);
CREATE TABLE IF NOT EXISTS rcs_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO rcs_settings(key, value) VALUES
 ('enabled', 'false'::jsonb),
 ('default_billing_mode', '"on_submission"'::jsonb),
 ('max_campaign_recipients', '50000'::jsonb),
 ('max_content_bytes', '32768'::jsonb)
ON CONFLICT (key) DO NOTHING;
