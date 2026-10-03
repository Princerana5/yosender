-- 041_rn_sender_addresses — selectable From address for rate notifications
CREATE TABLE IF NOT EXISTS rate_notification_senders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rn_senders_active ON rate_notification_senders(active) WHERE active;
-- seed default sender if missing
INSERT INTO rate_notification_senders (display_name, email, is_default, active)
VALUES ('8xtel Rate Notification', 'rates@8xtel.com', true, true)
ON CONFLICT (email) DO NOTHING;
-- also ensure is_default unique partial — only one default
CREATE OR REPLACE FUNCTION rn_senders_one_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE rate_notification_senders SET is_default=false WHERE id <> NEW.id;
  END IF;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_rn_senders_one_default ON rate_notification_senders;
CREATE TRIGGER trg_rn_senders_one_default AFTER INSERT OR UPDATE OF is_default ON rate_notification_senders
FOR EACH ROW WHEN (NEW.is_default) EXECUTE FUNCTION rn_senders_one_default();
