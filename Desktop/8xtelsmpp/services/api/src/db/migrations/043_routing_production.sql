-- 043_routing_production — production SMPP routing system (52-point spec)
-- Adds: route health / circuit breaker, routing logs, failover logs,
-- route_groups members, failover rules, routing rules (country/MCC/MNC/sender/type/source/time),
-- traffic distribution validation, indexes, audit support.

-- ── routes extensions (quality / priority / traffic_mode) ──────────────────
ALTER TABLE routes ADD COLUMN IF NOT EXISTS traffic_mode TEXT DEFAULT 'priority'
  CHECK (traffic_mode IN ('weighted','priority','least_cost','best_quality','round_robin','failover_only'));
ALTER TABLE routes ADD COLUMN IF NOT EXISTS quality_tier TEXT DEFAULT 'standard'
  CHECK (quality_tier IN ('direct','premium','standard','economy','otp','transactional','promotional','international','custom'));
ALTER TABLE routes ADD COLUMN IF NOT EXISTS priority_rank INT DEFAULT 1 CHECK (priority_rank BETWEEN 1 AND 10);
ALTER TABLE routes ADD COLUMN IF NOT EXISTS weight_total INT DEFAULT 100;
-- keep strategy in sync with traffic_mode for legacy engine
UPDATE routes SET traffic_mode = CASE strategy
  WHEN 'percentage' THEN 'weighted' WHEN 'least_cost' THEN 'least_cost'
  WHEN 'round_robin' THEN 'round_robin' WHEN 'failover' THEN 'failover_only'
  ELSE 'priority' END WHERE traffic_mode IS NULL;

CREATE INDEX IF NOT EXISTS idx_routes_traffic_mode ON routes(traffic_mode);
CREATE INDEX IF NOT EXISTS idx_routes_quality ON routes(quality_tier);

-- ── route_groups members (many-to-many) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS route_group_members (
  group_id UUID NOT NULL REFERENCES route_groups(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  weight INT NOT NULL DEFAULT 100 CHECK (weight >= 0 AND weight <= 100),
  priority INT NOT NULL DEFAULT 1 CHECK (priority >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, route_id)
);
CREATE INDEX IF NOT EXISTS idx_rgm_group ON route_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_rgm_route ON route_group_members(route_id);

-- ── routing_rules — country/MCC/MNC/sender/type/source/time (§18) ─────────
CREATE TABLE IF NOT EXISTS routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  route_group_id UUID REFERENCES route_groups(id) ON DELETE SET NULL,
  route_id UUID REFERENCES routes(id) ON DELETE SET NULL,
  country_id UUID REFERENCES countries(id) ON DELETE SET NULL,
  prefix TEXT,
  mcc TEXT,
  mnc TEXT,
  sender_id TEXT,
  message_type TEXT CHECK (message_type IN ('otp','promotional','transactional','any')),
  source_type TEXT CHECK (source_type IN ('smpp','http','api','any')),
  source_value TEXT,
  time_from TIME,
  time_to TIME,
  traffic_mode TEXT DEFAULT 'priority' CHECK (traffic_mode IN ('weighted','priority','least_cost','best_quality','round_robin','failover_only')),
  priority INT NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_routing_rules_country ON routing_rules(country_id) WHERE country_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routing_rules_prefix ON routing_rules(prefix) WHERE prefix IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routing_rules_sender ON routing_rules(sender_id) WHERE sender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routing_rules_mccmnc ON routing_rules(mcc, mnc);
CREATE INDEX IF NOT EXISTS idx_routing_rules_enabled ON routing_rules(enabled, priority);

-- ── failover_rules — configurable failover chain (§14) ─────────────────────
CREATE TABLE IF NOT EXISTS failover_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  priority INT NOT NULL DEFAULT 1,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  failover_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  condition TEXT DEFAULT 'any_failure' CHECK (condition IN ('any_failure','timeout','rejected','undelivered','expired','all')),
  max_attempts INT NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 5),
  retry_delay_ms INT NOT NULL DEFAULT 500 CHECK (retry_delay_ms BETWEEN 0 AND 10000),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_id, vendor_id)
);
CREATE INDEX IF NOT EXISTS idx_failover_route ON failover_rules(route_id);

-- ── route_health — per-vendor health + circuit breaker (§16) ───────────────
CREATE TABLE IF NOT EXISTS route_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  circuit_state TEXT NOT NULL DEFAULT 'HEALTHY' CHECK (circuit_state IN ('HEALTHY','DEGRADED','OPEN','RECOVERING')),
  connection_ok BOOLEAN NOT NULL DEFAULT TRUE,
  availability_pct NUMERIC(5,2),
  submit_success_pct NUMERIC(5,2),
  dlr_success_pct NUMERIC(5,2),
  avg_response_ms INT,
  timeout_pct NUMERIC(5,2),
  error_pct NUMERIC(5,2),
  total_sends BIGINT NOT NULL DEFAULT 0,
  total_failures BIGINT NOT NULL DEFAULT 0,
  consecutive_failures INT NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ,
  recover_at TIMESTAMPTZ,
  cooldown_seconds INT NOT NULL DEFAULT 300,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_id, vendor_id)
);
CREATE INDEX IF NOT EXISTS idx_route_health_state ON route_health(circuit_state);
CREATE INDEX IF NOT EXISTS idx_route_health_vendor ON route_health(vendor_id) WHERE vendor_id IS NOT NULL;

-- ── routing_logs — full trace (§22) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS routing_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  route_id UUID REFERENCES routes(id) ON DELETE SET NULL,
  route_code TEXT,
  country_id UUID REFERENCES countries(id) ON DELETE SET NULL,
  destination TEXT NOT NULL,
  source TEXT,
  channel TEXT DEFAULT 'sms',
  strategy TEXT,
  traffic_mode TEXT,
  vendor_chain JSONB,
  selected_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  selected_vendor_name TEXT,
  price_per_segment NUMERIC(18,6),
  vendor_cost NUMERIC(18,6),
  margin NUMERIC(18,6),
  failover_attempts INT NOT NULL DEFAULT 0,
  routing_rule_id UUID REFERENCES routing_rules(id) ON DELETE SET NULL,
  health_state TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_routing_logs_client ON routing_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_routing_logs_route ON routing_logs(route_id);
CREATE INDEX IF NOT EXISTS idx_routing_logs_vendor ON routing_logs(selected_vendor_id);
CREATE INDEX IF NOT EXISTS idx_routing_logs_country ON routing_logs(country_id);
CREATE INDEX IF NOT EXISTS idx_routing_logs_created ON routing_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_routing_logs_message ON routing_logs(message_id) WHERE message_id IS NOT NULL;

-- ── failover_logs — every failover hop (§22) ───────────────────────────────
CREATE TABLE IF NOT EXISTS failover_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  route_id UUID REFERENCES routes(id) ON DELETE SET NULL,
  from_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  to_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  attempt INT NOT NULL DEFAULT 1,
  success BOOLEAN,
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_failover_logs_route ON failover_logs(route_id);
CREATE INDEX IF NOT EXISTS idx_failover_logs_message ON failover_logs(message_id);
CREATE INDEX IF NOT EXISTS idx_failover_logs_created ON failover_logs(created_at DESC);

-- ── vendor_rates MCC/MNC awareness (extend existing) ───────────────────────
ALTER TABLE vendor_rates ADD COLUMN IF NOT EXISTS mcc TEXT;
ALTER TABLE vendor_rates ADD COLUMN IF NOT EXISTS mnc TEXT;
CREATE INDEX IF NOT EXISTS idx_vendor_rates_mccmnc ON vendor_rates(mcc, mnc) WHERE mcc IS NOT NULL;

-- ── audit log helper index ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_messages_route_vendor_time ON messages(route_id, vendor_id, created_at DESC);

COMMENT ON TABLE routing_logs IS '§22 Full routing trace: every message resolution with chain, pricing, health.';
COMMENT ON TABLE failover_logs IS '§22 Every failover hop with reason and latency.';
COMMENT ON TABLE route_health IS '§16 Circuit breaker HEALTHY/DEGRADED/OPEN/RECOVERING with cooldown.';
COMMENT ON TABLE failover_rules IS '§14 Configurable failover chain per route/vendor.';
COMMENT ON TABLE routing_rules IS '§18 Country/MCC/MNC/sender/type/source/time routing rules.';
