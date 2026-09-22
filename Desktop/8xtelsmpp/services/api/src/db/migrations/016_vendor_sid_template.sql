-- 016_vendor_sid_template — per-HTTP-vendor forced Sender ID + message template.
-- ADDITIVE ONLY: when set, the vendor-worker overrides the client sender with
-- force_sender_id and builds the upstream text from message_template, filling
-- {v1} {v2} … placeholders from the client message split on "|".
-- When NULL/blank, behavior is byte-identical passthrough (as before).
ALTER TABLE vendor_http_configs ADD COLUMN IF NOT EXISTS force_sender_id TEXT;
ALTER TABLE vendor_http_configs ADD COLUMN IF NOT EXISTS message_template TEXT;
