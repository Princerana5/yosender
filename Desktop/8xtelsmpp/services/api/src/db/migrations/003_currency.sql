-- 003_currency — multi-currency wallets (USD/EUR/INR) + FX rates
-- Wallets keep ONE native currency; conversion happens only on currency change.

CREATE TABLE IF NOT EXISTS fx_rates (
  code CHAR(3) PRIMARY KEY,                 -- USD | EUR | INR
  symbol TEXT NOT NULL,                     -- $ | € | ₹
  name TEXT NOT NULL,
  rate_to_usd NUMERIC(18,8) NOT NULL,       -- multiply native amount → USD
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO fx_rates (code, symbol, name, rate_to_usd) VALUES
  ('USD', '$', 'US Dollar', 1),
  ('EUR', '€', 'Euro', 1.08),
  ('INR', '₹', 'Indian Rupee', 0.012)
ON CONFLICT (code) DO NOTHING;

-- Rates carry their own currency so price lists stay correct per wallet
ALTER TABLE client_rates ADD COLUMN IF NOT EXISTS currency CHAR(3) DEFAULT 'USD';
ALTER TABLE vendor_rates ADD COLUMN IF NOT EXISTS currency CHAR(3) DEFAULT 'USD';
ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS currency CHAR(3) DEFAULT 'USD';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS currency CHAR(3);
