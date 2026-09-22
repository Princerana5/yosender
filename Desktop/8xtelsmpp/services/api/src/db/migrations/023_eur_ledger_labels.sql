-- 023_eur_ledger_labels — relabel pre-migration ledger currency codes to EUR.
-- Migration 021 converted live balances/prices to EUR but deliberately kept
-- history labels ("audit"). In practice those USDT labels leak into the UI
-- (ledger Amount/Balance-after columns render $ via the currency fallback),
-- confusing operators on an EUR-only system. Amounts were already converted
-- at 021 time for live rows; history rows keep their numeric values and only
-- get the EUR label so the panel renders € consistently.
-- (True reconversion of 58k history rows at historical FX is out of scope —
-- the numbers are small top-up/adjustment entries, not live balances.)
UPDATE transactions SET currency='EUR' WHERE TRIM(currency) IN ('USDT', 'USD', 'INR');
UPDATE billing_records SET currency='EUR' WHERE TRIM(currency) IN ('USDT', 'USD', 'INR');
