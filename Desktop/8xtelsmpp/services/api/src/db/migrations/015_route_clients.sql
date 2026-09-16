-- 015_route_clients — multi-client route membership (replaces global-vs-one).
--
-- Model: route_clients(route_id, client_id) = explicit membership.
--   - NO membership rows  → GLOBAL: serves every active client.
--   - HAS membership rows → SHARED/DEDICATED: serves only listed clients
--     (1 member = old "dedicated", N members = new multi-select).
-- routes.client_id (legacy single-owner column) is kept for compatibility and
-- backfilled INTO route_clients on first read, then ignored by the engine.
-- route_client_exclusions stays as the per-client "off switch" for globals.

CREATE TABLE IF NOT EXISTS route_clients (
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (route_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_route_clients_client ON route_clients (client_id);
CREATE INDEX IF NOT EXISTS idx_route_clients_route ON route_clients (route_id);

-- Backfill: legacy dedicated routes (client_id set) become 1-member routes.
INSERT INTO route_clients (route_id, client_id)
SELECT id, client_id FROM routes WHERE client_id IS NOT NULL
ON CONFLICT DO NOTHING;
