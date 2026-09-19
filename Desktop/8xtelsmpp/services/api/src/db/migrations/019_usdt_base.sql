-- 019_usdt_base — switch base currency USD → USDT (1:1, Tether USD-pegged)
-- USDT needs 4 chars: widen every currency column first, then relabel.
-- Balances are UNTOUCHED (1 USD = 1 USDT by peg).

-- 1. Widen all currency code columns to hold 'USDT'
ALTER TABLE fx_rates ALTER COLUMN code TYPE CHAR(4);
ALTER TABLE clients ALTER COLUMN currency TYPE CHAR(4);
ALTER TABLE wallets ALTER COLUMN currency TYPE CHAR(4);
ALTER TABLE routes ALTER COLUMN price_currency TYPE CHAR(4);
ALTER TABLE client_rates ALTER COLUMN currency TYPE CHAR(4);
ALTER TABLE vendor_rates ALTER COLUMN currency TYPE CHAR(4);
ALTER TABLE billing_records ALTER COLUMN currency TYPE CHAR(4);
ALTER TABLE transactions ALTER COLUMN currency TYPE CHAR(4);

-- 2. Relabel USD → USDT everywhere (1:1, amounts unchanged)
UPDATE fx_rates SET code='USDT', symbol='₮', name='Tether (USD-pegged)', rate_to_usd=1, source='seed', refreshed_at=NULL WHERE code='USD';
UPDATE clients SET currency='USDT' WHERE currency='USD';
UPDATE wallets SET currency='USDT' WHERE currency='USD';
UPDATE routes SET price_currency='USDT' WHERE price_currency='USD';
UPDATE client_rates SET currency='USDT' WHERE currency='USD';
UPDATE vendor_rates SET currency='USDT' WHERE currency='USD';
UPDATE billing_records SET currency='USDT' WHERE currency='USD';
UPDATE transactions SET currency='USDT' WHERE currency='USD';

-- 3. Fresh defaults for NEW rows
ALTER TABLE clients ALTER COLUMN currency SET DEFAULT 'USDT';
ALTER TABLE wallets ALTER COLUMN currency SET DEFAULT 'USDT';
ALTER TABLE routes ALTER COLUMN price_currency SET DEFAULT 'USDT';
ALTER TABLE client_rates ALTER COLUMN currency SET DEFAULT 'USDT';
ALTER TABLE vendor_rates ALTER COLUMN currency SET DEFAULT 'USDT';
ALTER TABLE billing_records ALTER COLUMN currency SET DEFAULT 'USDT';
