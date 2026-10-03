-- 042_vendor_blending — vendor rate adjustment + blending vendor attribution
-- 1) Vendor rate ops need updated_at + indexes for margin queries.
-- 2) Messages carry the actually-used (blending) vendor separately from the
--    route's primary vendor so DLR logs can show "Blending vendor" vs "Main vendor".

ALTER TABLE vendor_rates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE vendor_rates ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'EUR';
CREATE INDEX IF NOT EXISTS idx_vendor_rates_country ON vendor_rates(country_id) WHERE country_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_rates_vendor_country ON vendor_rates(vendor_id, country_id);

COMMENT ON COLUMN vendor_rates.cost IS 'Per-message termination cost (EUR). Edit via Vendors → Rates; drives route margin = sell - min(cost).';

-- Blending: the vendor that actually carried the message may differ from the
-- route's first-priority vendor (percentage split / failover). Store the
-- effective vendor explicitly so DLR logs can label it.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS blending_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_blending_vendor ON messages(blending_vendor_id) WHERE blending_vendor_id IS NOT NULL;

ALTER TABLE dlr_delay_queue ADD COLUMN IF NOT EXISTS blending_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;

-- Vendor cost snapshot at send time — already have per-message vendor_cost,
-- but ensure messages.vendor_cost is indexed for profitability.
CREATE INDEX IF NOT EXISTS idx_messages_vendor_cost ON messages(vendor_cost) WHERE vendor_cost IS NOT NULL;
