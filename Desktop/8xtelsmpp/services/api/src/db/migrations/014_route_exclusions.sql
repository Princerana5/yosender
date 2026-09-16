-- 014_route_exclusions — per-client detach of global routes (safe removal).
--
-- Problem: routes.client_id NULL = global (serves ALL clients). Deleting a
-- global route from one client's page wiped it for everyone.
-- Fix: detaching a global route from one client inserts an exclusion row
-- instead of deleting the route. The routing engine + coverage + client detail
-- all respect exclusions, so the route keeps serving everyone else.
-- Dedicated routes (client_id = X) are still deleted normally — they only
-- ever served that one client.

CREATE TABLE IF NOT EXISTS route_client_exclusions (
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (route_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_route_excl_client ON route_client_exclusions (client_id);
CREATE INDEX IF NOT EXISTS idx_route_excl_route ON route_client_exclusions (route_id);
