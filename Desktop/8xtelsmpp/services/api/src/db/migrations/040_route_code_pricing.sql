-- 040_route_code_pricing — scalable routing & pricing management (§1-§28)
-- Route Code unique, internal vendor cost (admin-only), route_type, per-client
-- per-country selling rates, rate history, decimal-safe, multi-currency.

-- ── routes: Route Code + internal cost + type + description ───────────────
ALTER TABLE routes ADD COLUMN IF NOT EXISTS route_code TEXT;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS internal_vendor_cost NUMERIC(18,6);
ALTER TABLE routes ADD COLUMN IF NOT EXISTS internal_cost_currency CHAR(3) DEFAULT 'EUR' CHECK (internal_cost_currency IN ('EUR','USD'));
ALTER TABLE routes ADD COLUMN IF NOT EXISTS route_type TEXT DEFAULT 'generic' CHECK (route_type IN ('generic','sms','otp','promotional','transactional','direct','wholesale'));
ALTER TABLE routes ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS currency CHAR(3) DEFAULT 'EUR' CHECK (currency IN ('EUR','USD'));

-- Backfill route_code for existing rows: R-{shortId}
UPDATE routes SET route_code = 'R-' || upper(substring(id::text,1,8)) WHERE route_code IS NULL;

-- Enforce unique after backfill (deferrable so migration succeeds even if dup short ids — extremely unlikely)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='routes_route_code_unique') THEN
    ALTER TABLE routes ADD CONSTRAINT routes_route_code_unique UNIQUE (route_code);
  END IF;
END$$;
CREATE INDEX IF NOT EXISTS idx_routes_route_code ON routes(route_code);
CREATE INDEX IF NOT EXISTS idx_routes_route_type ON routes(route_type);
CREATE INDEX IF NOT EXISTS idx_routes_currency ON routes(currency);

COMMENT ON COLUMN routes.route_code IS 'Mandatory unique business key e.g. IN-SMS-001, US-DIRECT-001. Used everywhere instead of name.';
COMMENT ON COLUMN routes.internal_vendor_cost IS 'ADMIN-ONLY purchase cost per segment from vendor. Never exposed to clients (API/portal/Excel/email).';
COMMENT ON COLUMN routes.route_type IS 'Route category for filtering/profitability.';

-- ── route_client_rates: extend to per-country/destination granularity ──────
-- Existing PK is (route_id, client_id) — relax to allow per-country rows.
-- Keep backwards compat: rows with country_id NULL = "all destinations" rate.
ALTER TABLE route_client_rates ADD COLUMN IF NOT EXISTS country_id UUID REFERENCES countries(id) ON DELETE CASCADE;
ALTER TABLE route_client_rates ADD COLUMN IF NOT EXISTS mcc TEXT;
ALTER TABLE route_client_rates ADD COLUMN IF NOT EXISTS mnc TEXT;
ALTER TABLE route_client_rates ADD COLUMN IF NOT EXISTS pricing_mode TEXT DEFAULT 'direct' CHECK (pricing_mode IN ('direct','percent_markup','fixed_markup'));
ALTER TABLE route_client_rates ADD COLUMN IF NOT EXISTS markup_value NUMERIC(18,6);
ALTER TABLE route_client_rates ADD COLUMN IF NOT EXISTS vendor_cost_snapshot NUMERIC(18,6);

-- Replace unique (route_id, client_id) with (route_id, client_id, coalesce(country_id,'00000000-0000-0000-0000-000000000000'), coalesce(mcc,''), coalesce(mnc,''))
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='route_client_rates_route_id_client_id_key') THEN
    ALTER TABLE route_client_rates DROP CONSTRAINT route_client_rates_route_id_client_id_key;
  END IF;
END$$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_route_client_country_rate
  ON route_client_rates(route_id, client_id, COALESCE(country_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(mcc,''), COALESCE(mnc,''));
CREATE INDEX IF NOT EXISTS idx_rcr_country ON route_client_rates(country_id) WHERE country_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rcr_mcc_mnc ON route_client_rates(mcc, mnc);

-- ── Rate history: every price change audited ──────────────────────────────
CREATE TABLE IF NOT EXISTS route_rate_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id          UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  country_id        UUID REFERENCES countries(id) ON DELETE SET NULL,
  mcc               TEXT,
  mnc               TEXT,
  previous_rate     NUMERIC(18,6),
  new_rate          NUMERIC(18,6) NOT NULL,
  currency          CHAR(3) NOT NULL DEFAULT 'EUR',
  pricing_mode      TEXT,
  markup_value      NUMERIC(18,6),
  changed_by        UUID REFERENCES users(id),
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  notification_status TEXT DEFAULT 'not_sent' CHECK (notification_status IN ('not_sent','sent','skipped')),
  sent_at           TIMESTAMPTZ,
  sent_by           UUID REFERENCES users(id),
  note              TEXT
);
CREATE INDEX IF NOT EXISTS idx_rrh_route ON route_rate_history(route_id);
CREATE INDEX IF NOT EXISTS idx_rrh_client ON route_rate_history(client_id);
CREATE INDEX IF NOT EXISTS idx_rrh_changed_at ON route_rate_history(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_rrh_country ON route_rate_history(country_id) WHERE country_id IS NOT NULL;

-- ── Profitability helper indexes (messages/billing_records) ───────────────
CREATE INDEX IF NOT EXISTS idx_messages_route_billing ON messages(route_id, billing_status, status) WHERE route_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_client_route_country_date ON messages(client_id, route_id, country_id, created_at);
CREATE INDEX IF NOT EXISTS idx_billing_records_route ON billing_records(client_id, created_at) INCLUDE (client_price, vendor_cost, profit);

-- ── Currency widening: allow USD alongside EUR on rates ───────────────────
DO $$
BEGIN
  -- Widen route_client_rates currency check if it was EUR-only
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='route_client_rates_currency_check') THEN
    ALTER TABLE route_client_rates DROP CONSTRAINT route_client_rates_currency_check;
  END IF;
  ALTER TABLE route_client_rates ADD CONSTRAINT route_client_rates_currency_check CHECK (currency IN ('EUR','USD'));
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='routes_price_currency_check') THEN
    ALTER TABLE routes DROP CONSTRAINT routes_price_currency_check;
  END IF;
  ALTER TABLE routes ADD CONSTRAINT routes_price_currency_check CHECK (price_currency IN ('EUR','USD'));
EXCEPTION WHEN OTHERS THEN NULL;
END$$;
