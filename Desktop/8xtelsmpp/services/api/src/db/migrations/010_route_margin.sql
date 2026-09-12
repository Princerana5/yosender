-- 010: per-route minimum margin guard (warn-only).
-- min_margin_pct: required profit margin % over cheapest vendor cost.
-- NULL = no guard on this route. Prices below cost×(1+margin) are flagged
-- in the console + coverage, never blocked (sends always flow).
ALTER TABLE routes ADD COLUMN IF NOT EXISTS min_margin_pct NUMERIC(5,2);
