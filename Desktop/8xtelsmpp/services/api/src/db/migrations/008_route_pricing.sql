-- 008_route_pricing — per-route sell price + submit-time reservation (§13, §28)
--
-- Pricing priority for a message: route.price_per_segment (× segments) →
-- client_rates (longest prefix) → 0. The reservation is taken at ROUTING time
-- (submit), not at vendor accept — so balance drops the moment the client
-- pushes, and failed/expired messages release the hold via settlement.

ALTER TABLE routes ADD COLUMN IF NOT EXISTS price_per_segment NUMERIC(18,6);
ALTER TABLE routes ADD COLUMN IF NOT EXISTS price_currency CHAR(3) DEFAULT 'USD';

-- Segments + reservation snapshot per message
ALTER TABLE messages ADD COLUMN IF NOT EXISTS segments INT DEFAULT 1;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reserved_amount NUMERIC(18,6) DEFAULT 0;

-- Campaign-level reservation totals
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS reserved_amount NUMERIC(18,6) DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS settled_amount NUMERIC(18,6) DEFAULT 0;
