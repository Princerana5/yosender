-- 004_billing_pro — deduct support, prepay/postpay mode, mandatory remarks
ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_mode TEXT DEFAULT 'prepay';
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS billing_mode TEXT DEFAULT 'prepay';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS remark TEXT;

-- backfill remark from description where missing
UPDATE transactions SET remark = description WHERE remark IS NULL;

-- constrain billing_mode values
DO $$ BEGIN
  ALTER TABLE clients ADD CONSTRAINT chk_clients_billing_mode CHECK (billing_mode IN ('prepay','postpay'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE wallets ADD CONSTRAINT chk_wallets_billing_mode CHECK (billing_mode IN ('prepay','postpay'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
