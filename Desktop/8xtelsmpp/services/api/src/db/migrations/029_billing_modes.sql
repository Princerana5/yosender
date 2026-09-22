-- 029_billing_modes — WHEN the client is charged, per rate row + per message.
-- billing_mode is orthogonal to route/vendor/MCC/MNC/currency/rate/DLR status:
-- it selects the billing EVENT (submit-time vs delivered-DLR vs hybrid split).
-- Default 'on_submission' preserves existing behavior for all old rows.

-- 1. Rate rows (RN + saved cards)
ALTER TABLE rate_notification_rates ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'on_submission';
ALTER TABLE rate_notification_rates ADD COLUMN IF NOT EXISTS delivery_rate NUMERIC(18,6);
ALTER TABLE client_saved_rates ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'on_submission';
ALTER TABLE client_saved_rates ADD COLUMN IF NOT EXISTS delivery_rate NUMERIC(18,6);

-- 2. Per-message billing state (idempotency: one row per message per component)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'on_submission';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS billed_amount NUMERIC(18,6) DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS billing_currency CHAR(3);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS submission_billed_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_billed_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS operator_submission_billed_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS operator_delivery_billed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_messages_billing_mode ON messages (billing_mode);
CREATE INDEX IF NOT EXISTS idx_messages_billing_status ON messages (billing_status);

-- 3. Ledger: one row per (message, component) — duplicate DLRs can never
-- double-charge (PK), and submission+delivery splits stay auditable.
CREATE TABLE IF NOT EXISTS billing_charges (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  component TEXT NOT NULL,              -- submission|delivery
  client_id UUID REFERENCES clients(id),
  amount NUMERIC(18,6) NOT NULL,
  currency CHAR(3),
  billing_event TEXT NOT NULL,          -- SUBMITTED|DELIVERED|OPERATOR_*|...
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (message_id, component)
);
CREATE INDEX IF NOT EXISTS idx_billing_charges_client ON billing_charges (client_id, created_at DESC);
