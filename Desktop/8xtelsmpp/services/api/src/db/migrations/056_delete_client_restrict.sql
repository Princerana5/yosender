-- 056_delete_client_restrict — make client delete succeed when ledger/history exists
-- Several tables FK to clients(id) with NO ACTION / RESTRICT, so
-- DELETE FROM clients is blocked when billing_charges etc. exist.
-- The API now deletes those dependents before the row, but the FKs
-- should also be loose so statement-level restarts / edge cases don't
-- 500. Idempotent.

DO $$
DECLARE r RECORD;
BEGIN
  -- Drop every FK from any table that references clients(id) without CASCADE/SET NULL,
  -- then recreate it as ON DELETE CASCADE (history tables) via the app's
  -- explicit handling — but at DB level keep it defeasible so a stray
  -- DELETE doesn't 500 if the app transaction retries.
  -- Tightest read: recreate as CASCADE for dependent-ledger tables,
  -- SET NULL for message-history tables already detached in code.
  FOR r IN
    SELECT conname, conrelid::regclass AS tbl, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE contype='f' AND confrelid='clients'::regclass
      AND pg_get_constraintdef(oid) NOT ILIKE '%ON DELETE CASCADE%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%ON DELETE SET NULL%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END$$;

-- Recreate them with CASCADE so a raw DELETE still succeeds.
-- For history-bearing tables (messages, billing_records) the app already
-- NULs the column — CASCADE is a safety net for non-history tables.
DO $$
BEGIN
  -- billing_charges — the exact table from the reported error
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='billing_charges_client_id_fkey') THEN
    ALTER TABLE billing_charges ADD CONSTRAINT billing_charges_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
  END IF;
  -- credit bundles / ledger
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='credit_transactions_client_id_fkey') THEN
    BEGIN
      ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_api_keys_client_id_fkey') THEN
    BEGIN
      ALTER TABLE client_api_keys ADD CONSTRAINT client_api_keys_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  -- rate / pricing dependents
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_saved_rates_client_id_fkey') THEN
    BEGIN
      ALTER TABLE client_saved_rates ADD CONSTRAINT client_saved_rates_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='route_client_rates_client_id_fkey') THEN
    BEGIN
      ALTER TABLE route_client_rates ADD CONSTRAINT route_client_rates_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  -- invoices cascade already exists — ensure billing invoices do
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rate_notifications_client_id_fkey') THEN
    BEGIN
      ALTER TABLE rate_notifications ADD CONSTRAINT rate_notifications_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
  -- rcs domain — already CASCADE in 047, but guard for partial deploys
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rcs_billing_records_client_id_fkey') THEN
      ALTER TABLE rcs_billing_records ADD CONSTRAINT rcs_billing_records_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
    END IF;
  EXCEPTION WHEN duplicate_object THEN NULL;
    WHEN undefined_table THEN NULL;
  END;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rcs_ledger_client_id_fkey') THEN
      ALTER TABLE rcs_ledger ADD CONSTRAINT rcs_ledger_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
    END IF;
  EXCEPTION WHEN duplicate_object THEN NULL;
    WHEN undefined_table THEN NULL;
  END;
END$$;
