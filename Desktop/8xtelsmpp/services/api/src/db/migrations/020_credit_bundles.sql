-- 020_credit_bundles — SMS-credit billing mode (1 credit = 1 segment)
-- Per-client opt-in: billing_mode='credit' burns credits instead of money.
-- Money wallets are untouched; credits live alongside (sms_credits).
-- Holds mirror the money flow: reserve at routing, settle on outcome,
-- refund on non-delivered DLR. Ledger via credit_transactions (immutable).

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS sms_credits NUMERIC(18,2) DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sms_credits NUMERIC(18,2) DEFAULT 0;

-- messages: track the credit hold separately from the money hold
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reserved_credits NUMERIC(18,2) DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS credits_charged NUMERIC(18,2);

-- Immutable credit ledger (grants, burns, refunds, adjustments)
CREATE TABLE IF NOT EXISTS credit_transactions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id UUID REFERENCES clients(id),
  message_id UUID REFERENCES messages(id),
  type TEXT NOT NULL,                        -- grant|burn|refund|adjustment|expiry
  amount NUMERIC(18,2) NOT NULL,             -- +grant/refund, -burn
  balance_after NUMERIC(18,2) NOT NULL,
  description TEXT,
  remark TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ctx_client_time ON credit_transactions (client_id, created_at DESC);

-- Allow 'credit' billing mode
ALTER TABLE clients DROP CONSTRAINT IF EXISTS chk_clients_billing_mode;
ALTER TABLE clients ADD CONSTRAINT chk_clients_billing_mode CHECK (billing_mode IN ('prepay','postpay','credit'));
ALTER TABLE wallets DROP CONSTRAINT IF EXISTS chk_wallets_billing_mode;
ALTER TABLE wallets ADD CONSTRAINT chk_wallets_billing_mode CHECK (billing_mode IN ('prepay','postpay','credit'));
