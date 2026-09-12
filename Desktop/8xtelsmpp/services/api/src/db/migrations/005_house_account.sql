-- 005_house_account — house "Main Account" client for admin test sends (§4)
--
-- Test SMS from the console is billed to this house account instead of forcing
-- the admin to impersonate a real client. Flagged is_house so the UI can
-- default to it and the Clients page can badge it. Idempotent.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_house BOOLEAN DEFAULT FALSE;

-- bcrypt hash of a random 32-byte secret (SMPP binds disabled for house
-- accounts at the API layer; the hash is a placeholder, never used).
-- Generated once; value is not a real credential.
INSERT INTO clients (name, company_name, system_id, password_hash, status, credit_limit, currency,
                     tps_limit, billing_mode, is_house, notes)
VALUES ('Main Account', '8xtel (house)', 'house_main',
        '$2a$12$FWBDIGBiTYTNGBi7P4OIN.KOcbUru2lNbinzWeqLjB3j7fuEQQFp2',
        'active', 1000, 'USD', 100, 'postpay', TRUE,
        'House account — admin test sends from the console are billed here.')
ON CONFLICT (system_id) DO UPDATE SET is_house=TRUE, status='active';

INSERT INTO wallets (client_id, balance, credit_limit, currency, billing_mode)
SELECT id, 0, 1000, 'USD', 'postpay' FROM clients WHERE system_id='house_main'
ON CONFLICT (client_id) DO UPDATE SET billing_mode='postpay';
