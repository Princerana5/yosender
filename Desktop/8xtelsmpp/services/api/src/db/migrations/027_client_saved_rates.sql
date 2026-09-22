-- 027_client_saved_rates — per-client rate cards for Rate Notifications.
-- On every RN send the destination rows are upserted here, so next time the
-- admin just selects the client and the rates prefill. Admin can edit/remove.
CREATE TABLE IF NOT EXISTS client_saved_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  country TEXT NOT NULL,
  country_code CHAR(2),
  network_name TEXT NOT NULL,
  mcc TEXT NOT NULL,
  mnc TEXT NOT NULL,
  currency CHAR(3) NOT NULL,
  rate NUMERIC(18,6) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, country, network_name, mcc, mnc, currency)
);
CREATE INDEX IF NOT EXISTS idx_csr_client ON client_saved_rates (client_id);
