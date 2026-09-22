-- 024_otp_transform — route-level OTP Sender ID & Template Prefix Mapping (India HSP).
-- ADDITIVE ONLY: all new columns nullable/default-off; existing routing is
-- byte-identical when otp_transform_enabled is false (the default).

-- ── Approved OTP templates (admin-managed, vendor-approved SID + DLT text) ──
CREATE TABLE IF NOT EXISTS otp_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  template_ref TEXT,                       -- DLT Template ID / vendor reference
  sender_id TEXT NOT NULL,                 -- approved vendor SID (e.g. MYBANK)
  content TEXT NOT NULL,                   -- must contain the otp_placeholder
  otp_placeholder TEXT NOT NULL DEFAULT '{OTP}',
  status TEXT NOT NULL DEFAULT 'active',   -- active|inactive
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_templates_status ON otp_templates (status);

-- ── Route-level transformation switch + fallback behaviour ──────────────────
ALTER TABLE routes ADD COLUMN IF NOT EXISTS otp_transform_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS otp_default_template_id UUID REFERENCES otp_templates(id) ON DELETE SET NULL;
-- What to do when no OTP is extractable / no template resolves:
-- 'reject' → message rejected with clear reason; 'passthrough' → existing routing untouched.
ALTER TABLE routes ADD COLUMN IF NOT EXISTS otp_on_no_otp TEXT NOT NULL DEFAULT 'reject';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS otp_on_no_template TEXT NOT NULL DEFAULT 'reject';

-- ── Optional per-client template override (falls back to route default) ─────
CREATE TABLE IF NOT EXISTS route_otp_clients (
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES otp_templates(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (route_id, client_id)
);

-- ── Original vs transformed audit trail on the message itself ───────────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS original_source TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS original_text TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS extracted_otp TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS otp_template_id UUID REFERENCES otp_templates(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS otp_transformed BOOLEAN NOT NULL DEFAULT FALSE;
