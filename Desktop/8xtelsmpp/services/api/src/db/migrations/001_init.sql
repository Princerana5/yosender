-- 001_init — 8xtelSMPP base schema (§35)
-- users / RBAC, clients, vendors, countries, routes, sender ids

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── RBAC ────────────────────────────────────────────────────────────────────
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,               -- super_admin|admin|operations|finance|support|read_only
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,             -- bcrypt (§32)
  full_name TEXT,
  role_id UUID REFERENCES roles(id),
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- CITEXT may not exist; fallback:
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS citext;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ── Countries / prefixes (§22) ──────────────────────────────────────────────
CREATE TABLE countries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  iso_code CHAR(2) NOT NULL,
  calling_code TEXT NOT NULL,              -- e.g. '91'
  status TEXT DEFAULT 'active',            -- active|disabled
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (iso_code)
);

CREATE TABLE prefixes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id UUID REFERENCES countries(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL,                    -- e.g. '9198'
  operator TEXT,
  UNIQUE (prefix, operator)
);
CREATE INDEX idx_prefixes_prefix ON prefixes (prefix);

-- ── Clients (§4–§6) ─────────────────────────────────────────────────────────
CREATE TABLE pricing_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  currency CHAR(3) DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company_name TEXT,
  system_id TEXT UNIQUE NOT NULL,          -- SMPP username
  password_hash TEXT NOT NULL,             -- SMPP password (bcrypt)
  status TEXT DEFAULT 'pending',           -- active|suspended|blocked|pending
  balance NUMERIC(18,6) DEFAULT 0,
  credit_limit NUMERIC(18,6) DEFAULT 0,
  currency CHAR(3) DEFAULT 'USD',
  default_route_id UUID,
  tps_limit INT DEFAULT 10,
  daily_limit BIGINT,
  monthly_limit BIGINT,
  pricing_profile_id UUID REFERENCES pricing_profiles(id),
  dlr_mode TEXT DEFAULT 'smpp',            -- smpp|http|api|none (§17)
  dlr_callback_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_clients_system_id ON clients (system_id);
CREATE INDEX idx_clients_status ON clients (status);

CREATE TABLE client_ips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,                        -- single IP or CIDR
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, ip)
);

CREATE TABLE client_rates (                -- §13
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES pricing_profiles(id) ON DELETE CASCADE,
  country_id UUID REFERENCES countries(id),
  prefix TEXT,
  price NUMERIC(18,6) NOT NULL,
  effective_from TIMESTAMPTZ DEFAULT now(),
  UNIQUE (profile_id, country_id, prefix)
);
CREATE INDEX idx_client_rates_lookup ON client_rates (profile_id, prefix);

CREATE TABLE sender_ids (                  -- §21
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  country_id UUID REFERENCES countries(id), -- null = global
  status TEXT DEFAULT 'approved',          -- approved|blocked|pending
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, sender, country_id)
);

-- ── Vendors (§7–§8) ─────────────────────────────────────────────────────────
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  host TEXT NOT NULL,
  port INT DEFAULT 2775,
  system_id TEXT NOT NULL,
  password_enc TEXT NOT NULL,              -- encrypted, never logged (§32)
  bind_type TEXT DEFAULT 'transceiver',    -- transceiver|transmitter|receiver
  source_ton SMALLINT DEFAULT 0,
  source_npi SMALLINT DEFAULT 1,
  dest_ton SMALLINT DEFAULT 0,
  dest_npi SMALLINT DEFAULT 1,
  tps INT DEFAULT 50,
  connection_count INT DEFAULT 1,
  dlr_supported BOOLEAN DEFAULT TRUE,
  use_tls BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'disabled',          -- enabled|disabled
  reconnect_interval_sec INT DEFAULT 10,
  sender_id_rule TEXT DEFAULT 'passthrough',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE vendor_rates (                -- §14
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  country_id UUID REFERENCES countries(id),
  prefix TEXT,
  operator TEXT,
  sender_type TEXT,
  cost NUMERIC(18,6) NOT NULL,
  effective_from TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_vendor_rates_lookup ON vendor_rates (vendor_id, prefix);

CREATE TABLE vendor_connections (          -- live state mirror (§9)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  conn_index INT DEFAULT 0,
  status TEXT DEFAULT 'disconnected',      -- connected|disconnected|connecting|reconnecting|error
  connected_since TIMESTAMPTZ,
  messages_sent BIGINT DEFAULT 0,
  messages_received BIGINT DEFAULT 0,
  dlr_count BIGINT DEFAULT 0,
  last_error TEXT,
  reconnect_count INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (vendor_id, conn_index)
);

-- ── Routes (§10–§12, §24) ───────────────────────────────────────────────────
CREATE TABLE route_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,               -- "India Premium Route"
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  channel TEXT DEFAULT 'sms',              -- sms|whatsapp|rcs (§24)
  client_id UUID REFERENCES clients(id),   -- null = global
  country_id UUID REFERENCES countries(id),
  prefix TEXT,
  sender_id TEXT,
  strategy TEXT DEFAULT 'priority',        -- priority|failover|round_robin|least_cost|percentage
  status TEXT DEFAULT 'active',
  tps_limit INT,
  group_id UUID REFERENCES route_groups(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_routes_lookup ON routes (channel, client_id, country_id, prefix, status);

CREATE TABLE route_vendors (
  route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  priority INT DEFAULT 1,
  weight INT DEFAULT 100,                  -- percentage weight
  PRIMARY KEY (route_id, vendor_id)
);

CREATE TABLE traffic_policies (            -- §19 (auditable, raw DLR immutable)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  route_id UUID REFERENCES routes(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES vendors(id),
  percentage INT DEFAULT 100,
  report_policy TEXT DEFAULT 'actual',     -- actual|sampled (never rewrites raw DLR)
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE filters (                     -- §20
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  client_id UUID REFERENCES clients(id),
  match_country_id UUID REFERENCES countries(id),
  match_prefix TEXT,
  match_sender TEXT,
  match_content TEXT,
  action TEXT NOT NULL,                    -- allow|block|reject|reroute|queue
  reroute_id UUID REFERENCES routes(id),
  priority INT DEFAULT 100,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);
