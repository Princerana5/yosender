-- 011: live downstream client bind mirror.
-- smpp-server is the sole writer: one row per accepted SMPP bind session,
-- deleted on unbind/close, wiped on server boot (all binds die on restart).
-- The API reads this for the Clients list + detail bind status.
-- Rows with recent activity = live; quiet rows = idle (bound but silent);
-- no rows = offline (last seen comes from smpp_logs).
CREATE TABLE IF NOT EXISTS client_binds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  system_id TEXT NOT NULL,
  bind_type TEXT NOT NULL,                 -- transceiver|transmitter|receiver
  remote_ip TEXT NOT NULL,
  connected_since TIMESTAMPTZ DEFAULT now(),
  last_activity_at TIMESTAMPTZ DEFAULT now(),
  submit_count BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_binds_client ON client_binds (client_id);
CREATE INDEX IF NOT EXISTS idx_client_binds_activity ON client_binds (last_activity_at);
