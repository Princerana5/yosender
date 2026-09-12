-- 006_client_portal — client self-service portal (§4)
--
-- Each client account can have ONE portal login (email + password, separate
-- from SMPP credentials and from console users). Portal tokens are kind='portal'
-- and can only touch /portal/* routes scoped to their own client_id.
-- Admins manage credentials + approve requests from the SMPP console.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_email TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_password_hash TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN DEFAULT FALSE;

-- Lowercase-unique portal emails (multiple NULLs allowed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_portal_email
  ON clients (lower(portal_email)) WHERE portal_email IS NOT NULL;

-- Wallet top-up requests: client asks, admin approves (= real topup) or rejects
CREATE TABLE IF NOT EXISTS topup_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  amount NUMERIC(18,6) NOT NULL CHECK (amount > 0),
  note TEXT,
  status TEXT DEFAULT 'pending',              -- pending|approved|rejected
  reviewed_by UUID,
  reviewer_remark TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_topup_req_client ON topup_requests (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topup_req_status ON topup_requests (status, created_at DESC);

-- Sender-ID requests: client asks, admin approves (= sender_ids row) or rejects
CREATE TABLE IF NOT EXISTS sender_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  country_id UUID REFERENCES countries(id),
  status TEXT DEFAULT 'pending',              -- pending|approved|rejected
  reviewed_by UUID,
  reviewer_remark TEXT,
  reviewed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sender_req_client ON sender_requests (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sender_req_status ON sender_requests (status, created_at DESC);
