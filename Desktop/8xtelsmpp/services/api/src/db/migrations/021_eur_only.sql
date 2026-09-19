-- 021_eur_only — EUR + SMS credits only. Retire USDT/USD/INR money.
-- Converts every money balance to EUR at fixed live rates (2026-09-19):
--   1 USDT (= 1 USD) = 0.871262 EUR
--   1 INR            = 0.009090 EUR  (1/110.011064)
-- SMS credits are untouched (unitless). Money history (transactions,
-- billing_records) keeps its original currency labels for audit — only live
-- balances + defaults + price lists move to EUR.

-- 1. Convert live money balances to EUR
UPDATE wallets SET
  balance = ROUND(balance * CASE currency WHEN 'USDT' THEN 0.871262 WHEN 'USD' THEN 0.871262 WHEN 'INR' THEN 0.009090 ELSE 1 END, 6),
  credit_limit = ROUND(credit_limit * CASE currency WHEN 'USDT' THEN 0.871262 WHEN 'USD' THEN 0.871262 WHEN 'INR' THEN 0.009090 ELSE 1 END, 6),
  currency = 'EUR'
WHERE currency IN ('USDT', 'USD', 'INR');

UPDATE clients SET
  balance = ROUND(balance * CASE currency WHEN 'USDT' THEN 0.871262 WHEN 'USD' THEN 0.871262 WHEN 'INR' THEN 0.009090 ELSE 1 END, 6),
  credit_limit = ROUND(credit_limit * CASE currency WHEN 'USDT' THEN 0.871262 WHEN 'USD' THEN 0.871262 WHEN 'INR' THEN 0.009090 ELSE 1 END, 6),
  currency = 'EUR'
WHERE currency IN ('USDT', 'USD', 'INR');

-- 2. Convert price lists to EUR (same factors)
UPDATE routes SET
  price_per_segment = ROUND(price_per_segment * CASE price_currency WHEN 'USDT' THEN 0.871262 WHEN 'USD' THEN 0.871262 WHEN 'INR' THEN 0.009090 ELSE 1 END, 6),
  price_currency = 'EUR'
WHERE price_currency IN ('USDT', 'USD', 'INR');

UPDATE client_rates SET
  price = ROUND(price * CASE currency WHEN 'USDT' THEN 0.871262 WHEN 'USD' THEN 0.871262 WHEN 'INR' THEN 0.009090 ELSE 1 END, 6),
  currency = 'EUR'
WHERE currency IN ('USDT', 'USD', 'INR');

UPDATE vendor_rates SET
  cost = ROUND(cost * CASE currency WHEN 'USDT' THEN 0.871262 WHEN 'USD' THEN 0.871262 WHEN 'INR' THEN 0.009090 ELSE 1 END, 6),
  currency = 'EUR'
WHERE currency IN ('USDT', 'USD', 'INR');

-- 3. Retire non-EUR FX rows; EUR becomes the base (rate 1)
DELETE FROM fx_rates WHERE code IN ('USDT', 'USD', 'INR');
UPDATE fx_rates SET rate_to_usd=1, symbol='€', name='Euro (base)', source='seed', refreshed_at=NULL
WHERE code='EUR';

-- 4. Fresh defaults for NEW rows
ALTER TABLE clients ALTER COLUMN currency SET DEFAULT 'EUR';
ALTER TABLE wallets ALTER COLUMN currency SET DEFAULT 'EUR';
ALTER TABLE routes ALTER COLUMN price_currency SET DEFAULT 'EUR';
ALTER TABLE client_rates ALTER COLUMN currency SET DEFAULT 'EUR';
ALTER TABLE vendor_rates ALTER COLUMN currency SET DEFAULT 'EUR';
ALTER TABLE billing_records ALTER COLUMN currency SET DEFAULT 'EUR';
