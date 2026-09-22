-- 012_http_vendors_client_api — HTTP upstream vendors + client API keys.
-- ADDITIVE ONLY: no existing table is altered except vendors, which gains a
-- single `protocol` column defaulting to 'smpp' — every existing row keeps
-- behaving exactly as before. SMPP code paths are untouched.

-- ── Vendors: transport protocol ─────────────────────────────────────────────
-- 'smpp' = classic SMPP bind (host/port/system_id/password_enc).
-- 'http' = upstream reachable via HTTP API (see vendor_http_configs).
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS protocol TEXT DEFAULT 'smpp';
DO $$ BEGIN
  ALTER TABLE vendors ADD CONSTRAINT chk_vendors_protocol CHECK (protocol IN ('smpp','http'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── HTTP vendor configs (one row per HTTP vendor) ───────────────────────────
-- url_template supports placeholders: {to} {from} {text} {msg_id} {dlr_url}.
-- For POST, body_template is sent (same placeholders); empty = GET-style query.
-- auth_header holds e.g. "Authorization: Bearer xxx" or "apikey: xxx" —
-- stored ENCRYPTED (same AES-256-GCM as SMPP passwords), never logged.
-- msgid_json_path: dot path to the vendor message id in their JSON response
--   (e.g. "message_id" or "data.id"). Empty = synthesize from our internal id.
CREATE TABLE IF NOT EXISTS vendor_http_configs (
  vendor_id UUID PRIMARY KEY REFERENCES vendors(id) ON DELETE CASCADE,
  url_template TEXT NOT NULL,
  method TEXT DEFAULT 'POST',                  -- GET|POST
  body_template TEXT,                          -- JSON body with placeholders, or NULL
  headers_enc TEXT,                            -- encrypted JSON: {"Header-Name":"value"}
  msgid_json_path TEXT,                        -- dot path to message id in response
  timeout_ms INT DEFAULT 10000,
  verify_tls BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Inbound DLR webhook tokens (one per HTTP vendor) ────────────────────────
-- Vendor calls POST /vendor-dlr/:token with their id + status; the token maps
-- back to the vendor without exposing internal ids. Stored as sha256 hash —
-- the plaintext token is shown once at creation.
CREATE TABLE IF NOT EXISTS vendor_dlr_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_dlr_tokens_vendor ON vendor_dlr_tokens (vendor_id);

-- ── Client API keys (HTTP send API for downstream clients) ──────────────────
-- Key plaintext shown ONCE at creation; only sha256 hash stored.
-- Client sends: Authorization: Bearer <key> (or ?api_key=) on /client/v1/*.
CREATE TABLE IF NOT EXISTS client_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  key_hash TEXT UNIQUE NOT NULL,
  key_prefix TEXT NOT NULL,                    -- first 8 chars, for identification
  label TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_api_keys_client ON client_api_keys (client_id);
