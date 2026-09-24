-- Per-client route rate override Vendor -> Route -> Client.
-- Priority: route_client_rates -> routes.price_per_segment * seg -> client_rates longest prefix -> 0
CREATE TABLE IF NOT EXISTS route_client_rates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id          UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  price_per_segment NUMERIC(18,6) NOT NULL CHECK (price_per_segment >= 0),
  currency          CHAR(3) NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  effective_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_route_client_rates_route ON route_client_rates(route_id);
CREATE INDEX IF NOT EXISTS idx_route_client_rates_client ON route_client_rates(client_id);
CREATE INDEX IF NOT EXISTS idx_route_client_rates_effective ON route_client_rates(effective_from);
COMMENT ON TABLE route_client_rates IS 'Per-client route rate override Vendor->Route->Client. Priority: route_client_rates -> routes.price_per_segment*seg -> client_rates longest prefix -> 0';
COMMENT ON COLUMN routes.price_per_segment IS 'Route default sell price per segment (fallback when no route_client_rates row)';
