ALTER TABLE rcs_messages
  ADD COLUMN IF NOT EXISTS billing_cycle INTEGER NOT NULL DEFAULT 0;

ALTER TABLE rcs_messages
  DROP CONSTRAINT IF EXISTS rcs_messages_billing_cycle_check;
ALTER TABLE rcs_messages
  ADD CONSTRAINT rcs_messages_billing_cycle_check CHECK (billing_cycle >= 0);

ALTER TABLE rcs_outbox
  ADD COLUMN IF NOT EXISTS dispatch_key TEXT NOT NULL DEFAULT 'initial';
ALTER TABLE rcs_outbox
  DROP CONSTRAINT IF EXISTS rcs_outbox_message_id_queue_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rcs_outbox_dispatch_unique
  ON rcs_outbox(message_id, queue_name, dispatch_key);
