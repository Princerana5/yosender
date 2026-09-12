-- 007_campaigns — bulk campaign sends + operator detail (§15, §25)
--
-- A campaign groups one send job (1..N destinations, same text/sender).
-- Per-number rows stay in messages (campaign_id links them); the campaign row
-- carries the pre-send estimate (encoding/segments/price) for the report.

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source TEXT NOT NULL,                          -- sender id used
  text TEXT NOT NULL,
  encoding TEXT NOT NULL DEFAULT 'gsm7',        -- gsm7|unicode (pre-send analysis)
  segments INT NOT NULL DEFAULT 1,              -- segments per message
  unit_price NUMERIC(18,6),                     -- client price per segment at send
  total_numbers INT NOT NULL DEFAULT 0,
  accepted INT NOT NULL DEFAULT 0,              -- queued for delivery
  rejected INT NOT NULL DEFAULT 0,              -- invalid/blocked before queue
  delivered INT NOT NULL DEFAULT 0,             -- cached counters (DLR worker bumps)
  failed INT NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'queued',                 -- queued|sending|done
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_client ON campaigns (client_id, created_at DESC);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages (campaign_id, created_at DESC);

-- Operator detail per message (MNC/MCC/operator resolved from prefixes at send;
-- NULL where the prefix table has no entry — country fallback still applies)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mnc TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mcc TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS operator_name TEXT;
