-- 044_vendor_synthetic_dlr — per-vendor synthetic DELIVRD toggle
-- When enabled, vendor-worker fakes a DELIVRD DLR 3-5s after submit for
-- vendors that never push a real DLR (e.g. MANISH). Lives in vendor section.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS synthetic_dlr_enabled BOOLEAN NOT NULL DEFAULT false;
-- seed MANISH on so existing behaviour stays identical after deploy
UPDATE vendors SET synthetic_dlr_enabled = true WHERE lower(name) LIKE '%manish%' AND synthetic_dlr_enabled = false;
CREATE INDEX IF NOT EXISTS idx_vendors_synthetic_dlr ON vendors(synthetic_dlr_enabled) WHERE synthetic_dlr_enabled = true;
COMMENT ON COLUMN vendors.synthetic_dlr_enabled IS 'When true, vendor-worker schedules a synthetic DELIVRD 3-5s after submit (for vendors that never push a real DLR). Toggled in Vendors → Synthetic delivery.';
