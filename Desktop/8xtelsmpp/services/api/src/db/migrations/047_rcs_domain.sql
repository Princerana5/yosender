-- Dedicated RCS domain. No RCS records are written to SMS message, route,
-- vendor, campaign, or billing tables.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS rcs_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS rcs_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  provider_key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  credentials_enc TEXT NOT NULL,
  webhook_secret_enc TEXT,
  status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('enabled','disabled','degraded')),
  tps_limit INT NOT NULL DEFAULT 10 CHECK (tps_limit > 0),
  timeout_ms INT NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 500 AND 60000),
  capabilities JSONB NOT NULL DEFAULT '{"text":true}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rcs_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  country_id UUID REFERENCES countries(id),
  sender TEXT,
  strategy TEXT NOT NULL DEFAULT 'priority' CHECK (strategy IN ('priority','percentage','failover')),
  status TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('active','disabled')),
  tps_limit INT CHECK (tps_limit IS NULL OR tps_limit > 0),
  daily_limit BIGINT CHECK (daily_limit IS NULL OR daily_limit > 0),
  monthly_limit BIGINT CHECK (monthly_limit IS NULL OR monthly_limit > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (name, country_id, sender)
);
CREATE TABLE IF NOT EXISTS rcs_route_vendors (
  route_id UUID NOT NULL REFERENCES rcs_routes(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES rcs_vendors(id) ON DELETE CASCADE,
  priority INT NOT NULL DEFAULT 1 CHECK (priority > 0),
  weight INT NOT NULL DEFAULT 100 CHECK (weight BETWEEN 1 AND 100),
  PRIMARY KEY (route_id, vendor_id)
);
CREATE TABLE IF NOT EXISTS rcs_route_clients (
  route_id UUID NOT NULL REFERENCES rcs_routes(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  PRIMARY KEY (route_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_rcs_routes_match ON rcs_routes(country_id, status);
CREATE INDEX IF NOT EXISTS idx_rcs_route_clients_client ON rcs_route_clients(client_id, route_id);

CREATE TABLE IF NOT EXISTS rcs_senders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  country_id UUID REFERENCES countries(id),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, sender, country_id)
);
CREATE TABLE IF NOT EXISTS rcs_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  country_id UUID NOT NULL REFERENCES countries(id),
  price NUMERIC(18,6) NOT NULL CHECK (price >= 0),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, country_id, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_rcs_rates_lookup ON rcs_rates(client_id, country_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS rcs_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sender TEXT NOT NULL,
  content JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','paused','completed','cancelled','failed')),
  billing_mode TEXT NOT NULL DEFAULT 'on_submission' CHECK (billing_mode IN ('on_submission','on_delivery')),
  recipient_count BIGINT NOT NULL DEFAULT 0,
  accepted_count BIGINT NOT NULL DEFAULT 0,
  rejected_count BIGINT NOT NULL DEFAULT 0,
  reserved_amount NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (reserved_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rcs_campaign_client_time ON rcs_campaigns(client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rcs_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  campaign_id UUID REFERENCES rcs_campaigns(id) ON DELETE SET NULL,
  route_id UUID REFERENCES rcs_routes(id),
  vendor_id UUID REFERENCES rcs_vendors(id),
  provider_message_id TEXT,
  client_message_id TEXT,
  idempotency_key TEXT,
  sender TEXT NOT NULL,
  destination TEXT NOT NULL,
  country_id UUID REFERENCES countries(id),
  content JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','queued','submitted','delivered','undelivered','expired','rejected','failed')),
  error_code TEXT,
  error_description TEXT,
  attempts INT NOT NULL DEFAULT 0,
  price NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (price >= 0),
  billing_state TEXT NOT NULL DEFAULT 'reserved' CHECK (billing_state IN ('reserved','charged','released','not_applicable')),
  submit_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  dlr_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rcs_messages_provider_id ON rcs_messages(vendor_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rcs_messages_client_time ON rcs_messages(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rcs_messages_status_time ON rcs_messages(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rcs_messages_campaign ON rcs_messages(campaign_id, created_at);

CREATE TABLE IF NOT EXISTS rcs_campaign_recipients (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES rcs_campaigns(id) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid','invalid','duplicate','empty','unsupported_country')),
  message_id UUID REFERENCES rcs_messages(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, destination)
);
CREATE INDEX IF NOT EXISTS idx_rcs_campaign_rejects ON rcs_campaign_recipients(campaign_id, validation_status);
CREATE TABLE IF NOT EXISTS rcs_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, name)
);

CREATE TABLE IF NOT EXISTS rcs_billing_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  campaign_id UUID REFERENCES rcs_campaigns(id) ON DELETE CASCADE,
  message_id UUID REFERENCES rcs_messages(id) ON DELETE CASCADE,
  amount NUMERIC(18,6) NOT NULL CHECK (amount >= 0),
  state TEXT NOT NULL DEFAULT 'held' CHECK (state IN ('held','consumed','released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ,
  CHECK ((campaign_id IS NULL) <> (message_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rcs_reservation_message ON rcs_billing_reservations(message_id) WHERE message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rcs_reservation_campaign ON rcs_billing_reservations(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS rcs_billing_records (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  message_id UUID REFERENCES rcs_messages(id),
  campaign_id UUID REFERENCES rcs_campaigns(id),
  event_key TEXT NOT NULL UNIQUE,
  amount NUMERIC(18,6) NOT NULL CHECK (amount >= 0),
  currency CHAR(3) NOT NULL,
  billing_mode TEXT NOT NULL CHECK (billing_mode IN ('on_submission','on_delivery')),
  event_type TEXT NOT NULL CHECK (event_type IN ('submission','delivery','refund','release')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (message_id IS NOT NULL OR campaign_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_rcs_billing_client_time ON rcs_billing_records(client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rcs_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES rcs_vendors(id),
  event_hash TEXT NOT NULL,
  provider_message_id TEXT,
  raw_body JSONB NOT NULL,
  signature_valid BOOLEAN NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending','processed','ignored','failed')),
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (vendor_id, event_hash)
);
CREATE INDEX IF NOT EXISTS idx_rcs_webhook_pending ON rcs_webhook_events(processing_status, received_at);
CREATE TABLE IF NOT EXISTS rcs_api_request_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  key_id UUID,
  request_id UUID NOT NULL DEFAULT gen_random_uuid(),
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INT,
  ip INET,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rcs_api_logs_client_time ON rcs_api_request_logs(client_id, created_at DESC);
CREATE TABLE IF NOT EXISTS rcs_dead_letters (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES rcs_messages(id) ON DELETE CASCADE,
  queue_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
