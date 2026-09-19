-- 018_fx_auto_refresh — track FX provenance (manual vs live API)
-- Lets the panel show whether a rate was hand-edited or auto-refreshed,
-- and when it was last refreshed.

ALTER TABLE fx_rates ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'seed';
ALTER TABLE fx_rates ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMPTZ;
