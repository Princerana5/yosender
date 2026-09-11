-- 002_messages_billing — messages, DLR, wallets, audit (§15–§17, §25, §28, §31)

-- ── Messages (partition-ready by created_at month) ──────────────────────────
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- internal message id
  client_id UUID REFERENCES clients(id),
  vendor_id UUID REFERENCES vendors(id),
  route_id UUID,
  channel TEXT DEFAULT 'sms',                      -- sms|whatsapp|rcs
  client_msg_id TEXT,
  vendor_msg_id TEXT,
  source TEXT,                                     -- sender id
  destination TEXT NOT NULL,
  country_id UUID,
  text TEXT,                                       -- content access-controlled (§25)
  data_coding SMALLINT DEFAULT 0,
  status TEXT DEFAULT 'submitted',                 -- submitted|delivered|undelivered|expired|rejected|failed|unknown
  client_price NUMERIC(18,6),
  vendor_cost NUMERIC(18,6),
  submit_time TIMESTAMPTZ DEFAULT now(),
  dlr_time TIMESTAMPTZ,
  error_code TEXT,
  error_description TEXT,
  attempts INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_messages_client_time ON messages (client_id, created_at DESC);
CREATE INDEX idx_messages_vendor_msg ON messages (vendor_msg_id);
CREATE INDEX idx_messages_dest ON messages (destination);
CREATE INDEX idx_messages_status_time ON messages (status, created_at DESC);
CREATE INDEX idx_messages_route ON messages (route_id, created_at DESC);

CREATE TABLE message_events (               -- per-attempt trail (failover hops)
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES vendors(id),
  event TEXT NOT NULL,                      -- routed|sent|failed|failover|dlr
  detail TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_msg_events_msg ON message_events (message_id);

-- ── DLRs: immutable raw record + client-visible status (§16, §19) ───────────
CREATE TABLE dlrs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  vendor_msg_id TEXT,
  raw_body TEXT NOT NULL,                   -- NEVER overwritten
  vendor_status TEXT,                       -- actual network/vendor DLR
  client_status TEXT,                       -- policy-derived client-visible status
  error_code TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (message_id)
);
CREATE INDEX idx_dlrs_vendor_msg ON dlrs (vendor_msg_id);

-- ── Wallets / ledger (immutable, auditable) (§28) ───────────────────────────
CREATE TABLE wallets (
  client_id UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  balance NUMERIC(18,6) DEFAULT 0,
  credit_limit NUMERIC(18,6) DEFAULT 0,
  currency CHAR(3) DEFAULT 'USD',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE transactions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id UUID REFERENCES clients(id),
  message_id UUID REFERENCES messages(id),
  type TEXT NOT NULL,                       -- debit|credit|refund|adjustment
  amount NUMERIC(18,6) NOT NULL,
  balance_after NUMERIC(18,6) NOT NULL,
  description TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_tx_client_time ON transactions (client_id, created_at DESC);

CREATE TABLE billing_records (              -- per-message revenue/cost/profit
  message_id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id),
  vendor_id UUID REFERENCES vendors(id),
  client_price NUMERIC(18,6) NOT NULL,
  vendor_cost NUMERIC(18,6) NOT NULL,
  profit NUMERIC(18,6) GENERATED ALWAYS AS (client_price - vendor_cost) STORED,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_billing_time ON billing_records (created_at DESC);

-- ── Channel connectors (§23 — WhatsApp/RCS via provider APIs, not SMPP) ─────
CREATE TABLE channel_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  channel TEXT NOT NULL,                    -- whatsapp|rcs
  provider TEXT NOT NULL,                   -- e.g. meta-cloud, twilio, dotgo
  config_enc TEXT NOT NULL,                 -- encrypted provider credentials
  status TEXT DEFAULT 'disabled',
  tps INT DEFAULT 20,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Logs (§27, §31) ─────────────────────────────────────────────────────────
CREATE TABLE smpp_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind TEXT NOT NULL,                       -- bind|submit|deliver|enquire|error|auth|ip_reject
  client_id UUID REFERENCES clients(id),
  vendor_id UUID REFERENCES vendors(id),
  ip TEXT,
  port INT,
  system_id TEXT,
  message_id UUID,
  result TEXT,
  reason TEXT,                              -- never passwords
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_smpp_logs_time ON smpp_logs (created_at DESC);
CREATE INDEX idx_smpp_logs_kind ON smpp_logs (kind, created_at DESC);

CREATE TABLE audit_logs (                   -- §31
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id UUID,
  actor_email TEXT,
  action TEXT NOT NULL,                     -- created_vendor, changed_rate, ...
  object_type TEXT,
  object_id TEXT,
  old_value JSONB,
  new_value JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_audit_time ON audit_logs (created_at DESC);

CREATE TABLE system_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_syslogs_time ON system_logs (created_at DESC);
