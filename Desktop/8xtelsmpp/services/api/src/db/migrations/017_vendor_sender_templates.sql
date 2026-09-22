-- 017_vendor_sender_templates — per-SID templates for HTTP vendors.
-- ADDITIVE ONLY: a vendor with several approved Sender IDs (e.g. MDRTEd,
-- PKSSSL, …) gets one row per SID, each with its own DLT template. At send
-- time the worker matches the client sender (case-insensitive); on no match
-- the default row wins so the vendor always sees an approved SID + matching
-- template. Vendors with zero rows behave exactly as before (passthrough /
-- legacy single forced SID from 016).
CREATE TABLE IF NOT EXISTS vendor_sender_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  template TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (vendor_id, sender_id)
);
CREATE INDEX IF NOT EXISTS idx_vendor_sender_templates_vendor ON vendor_sender_templates (vendor_id);
-- Carry over the single forced SID/template (016) as the default row.
INSERT INTO vendor_sender_templates (vendor_id, sender_id, template, is_default)
SELECT vendor_id, force_sender_id, message_template, TRUE
FROM vendor_http_configs
WHERE force_sender_id IS NOT NULL AND force_sender_id <> ''
  AND message_template IS NOT NULL AND message_template <> ''
ON CONFLICT (vendor_id, sender_id) DO NOTHING;
