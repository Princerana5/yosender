CREATE TABLE IF NOT EXISTS rcs_wallets (
  client_id UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  balance NUMERIC(18,6) NOT NULL DEFAULT 0,
  reserved NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  credit_limit NUMERIC(18,6) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rcs_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  reservation_id UUID REFERENCES rcs_billing_reservations(id),
  message_id UUID REFERENCES rcs_messages(id),
  campaign_id UUID REFERENCES rcs_campaigns(id),
  type TEXT NOT NULL CHECK (type IN ('reserve','charge','release','credit','debit','refund')),
  amount NUMERIC(18,6) NOT NULL CHECK (amount >= 0),
  balance_after NUMERIC(18,6) NOT NULL,
  reserved_after NUMERIC(18,6) NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rcs_ledger_client_time ON rcs_ledger(client_id, created_at DESC);
