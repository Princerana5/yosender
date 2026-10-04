-- 054_users_delete_nullify — allow deleting console users referenced by history
-- Several tables reference users(id) without ON DELETE SET NULL, so
-- DELETE FROM users is blocked when the user created/verified an invoice,
-- rate, etc. Fix by recreating those FKs as ON DELETE SET NULL.
-- Idempotent: safe to re-run.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid, conname, conrelid::regclass AS tbl
    FROM pg_constraint
    WHERE contype='f' AND confrelid='users'::regclass
  LOOP
    IF pg_get_constraintdef(r.oid) NOT ILIKE '%ON DELETE SET NULL%' THEN
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    END IF;
  END LOOP;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoices_generated_by_fkey') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoices_sent_by_fkey') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoices_paid_by_fkey') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_paid_by_fkey FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoice_payments_created_by_fkey') THEN
    ALTER TABLE invoice_payments ADD CONSTRAINT invoice_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoice_payments_verified_by_fkey') THEN
    ALTER TABLE invoice_payments ADD CONSTRAINT invoice_payments_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='route_client_rates_created_by_fkey') THEN
    ALTER TABLE route_client_rates ADD CONSTRAINT route_client_rates_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='route_rate_history_changed_by_fkey') THEN
    ALTER TABLE route_rate_history ADD CONSTRAINT route_rate_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='route_rate_history_sent_by_fkey') THEN
    ALTER TABLE route_rate_history ADD CONSTRAINT route_rate_history_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='audit_logs_actor_id_fkey') THEN
      ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END$$;
