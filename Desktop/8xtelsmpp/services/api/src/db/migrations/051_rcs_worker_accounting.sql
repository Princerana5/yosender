ALTER TABLE rcs_vendors
  ADD COLUMN IF NOT EXISTS daily_limit BIGINT,
  ADD COLUMN IF NOT EXISTS monthly_limit BIGINT;

ALTER TABLE rcs_billing_reservations
  ADD COLUMN IF NOT EXISTS consumed_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS released_amount NUMERIC(18,6) NOT NULL DEFAULT 0;

ALTER TABLE rcs_vendors
  DROP CONSTRAINT IF EXISTS rcs_vendors_daily_limit_check,
  DROP CONSTRAINT IF EXISTS rcs_vendors_monthly_limit_check;
ALTER TABLE rcs_vendors
  ADD CONSTRAINT rcs_vendors_daily_limit_check CHECK (daily_limit IS NULL OR daily_limit > 0),
  ADD CONSTRAINT rcs_vendors_monthly_limit_check CHECK (monthly_limit IS NULL OR monthly_limit > 0);

ALTER TABLE rcs_billing_reservations
  ADD CONSTRAINT rcs_reservation_amounts_check
  CHECK (consumed_amount >= 0 AND released_amount >= 0 AND consumed_amount + released_amount <= amount);
