-- 039_dlr_cutting_delay — DLR Cutting / Delay Control (route/client/country scoped)
-- Selection happens at routing time (counter + random pick per interval).
-- Selected messages have their LEGITIMATE vendor DLR delayed by the configured seconds.
-- Never fabricates, never rewrites the vendor status.

-- ── Cutting configuration (scoped, priority: country+route > route > client > global) ──
CREATE TABLE IF NOT EXISTS dlr_cutting_configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  percentage        NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (percentage >= 0 AND percentage <= 100),
  interval_messages INT NOT NULL DEFAULT 100 CHECK (interval_messages > 0),
  delay_seconds     INT NOT NULL DEFAULT 10 CHECK (delay_seconds >= 0),
  selection_mode    TEXT NOT NULL DEFAULT 'random' CHECK (selection_mode IN ('random','sequential')),
  scope             TEXT NOT NULL DEFAULT 'route' CHECK (scope IN ('global','route','client','country')),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  client_id         UUID REFERENCES clients(id) ON DELETE CASCADE,
  route_id          UUID REFERENCES routes(id) ON DELETE CASCADE,
  country_id        UUID REFERENCES countries(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- at most one active config per (scope,client,route,country) tuple — enforced in app, unique helps dedup
  UNIQUE (scope, client_id, route_id, country_id)
);
CREATE INDEX IF NOT EXISTS idx_dcc_scope ON dlr_cutting_configs (scope, status);
CREATE INDEX IF NOT EXISTS idx_dcc_route ON dlr_cutting_configs (route_id) WHERE route_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dcc_client ON dlr_cutting_configs (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dcc_country ON dlr_cutting_configs (country_id) WHERE country_id IS NOT NULL;

COMMENT ON TABLE dlr_cutting_configs IS 'DLR Cutting / Delay control. Priority: country+route > route > client > global. enabled+status=active both required to apply.';

-- ── Interval counter (one row per config; Redis is primary, DB is fallback for restarts) ──
CREATE TABLE IF NOT EXISTS dlr_cutting_counters (
  config_id UUID PRIMARY KEY REFERENCES dlr_cutting_configs(id) ON DELETE CASCADE,
  processed INT NOT NULL DEFAULT 0,
  selected  INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Which messages were selected at routing time ──────────────────────────
-- Written by routing-worker so dlr-worker can gate the delay queue.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS dlr_cutting_selected BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS dlr_cutting_config_id UUID REFERENCES dlr_cutting_configs(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS dlr_cutting_delay_seconds INT;
CREATE INDEX IF NOT EXISTS idx_messages_cutting_selected ON messages (dlr_cutting_selected) WHERE dlr_cutting_selected = TRUE;

-- ── Persistent delay queue (survives restart; worker drains on boot) ──────
CREATE TABLE IF NOT EXISTS dlr_delay_queue (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id            UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  dlr_id                UUID REFERENCES dlrs(id) ON DELETE SET NULL,
  client_id             UUID REFERENCES clients(id) ON DELETE SET NULL,
  route_id              UUID REFERENCES routes(id) ON DELETE SET NULL,
  vendor_id             UUID REFERENCES vendors(id) ON DELETE SET NULL,
  country_id            UUID REFERENCES countries(id) ON DELETE SET NULL,
  original_status       TEXT NOT NULL,
  selected              BOOLEAN NOT NULL DEFAULT TRUE,
  configured_percentage NUMERIC(5,2),
  configured_interval   INT,
  delay_seconds         INT NOT NULL,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  release_at            TIMESTAMPTZ NOT NULL,
  released_at           TIMESTAMPTZ,
  queue_status          TEXT NOT NULL DEFAULT 'queued' CHECK (queue_status IN ('queued','released','failed')),
  attempts              INT NOT NULL DEFAULT 0,
  last_error            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id)
);
CREATE INDEX IF NOT EXISTS idx_ddq_status_release ON dlr_delay_queue (queue_status, release_at);
CREATE INDEX IF NOT EXISTS idx_ddq_client ON dlr_delay_queue (client_id);
CREATE INDEX IF NOT EXISTS idx_ddq_route ON dlr_delay_queue (route_id);
CREATE INDEX IF NOT EXISTS idx_ddq_vendor ON dlr_delay_queue (vendor_id);
CREATE INDEX IF NOT EXISTS idx_ddq_country ON dlr_delay_queue (country_id);
CREATE INDEX IF NOT EXISTS idx_ddq_created ON dlr_delay_queue (created_at DESC);

-- ── Per-config live aggregates (updated by workers; API can also compute from dlr_delay_queue) ──
CREATE TABLE IF NOT EXISTS dlr_cutting_stats (
  config_id        UUID PRIMARY KEY REFERENCES dlr_cutting_configs(id) ON DELETE CASCADE,
  messages_processed INT NOT NULL DEFAULT 0,
  messages_selected  INT NOT NULL DEFAULT 0,
  dlrs_received      INT NOT NULL DEFAULT 0,
  dlrs_delayed       INT NOT NULL DEFAULT 0,
  dlrs_released      INT NOT NULL DEFAULT 0,
  currently_queued   INT NOT NULL DEFAULT 0,
  avg_delay_ms       INT,
  failed_jobs        INT NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
