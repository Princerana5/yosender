-- 037_invoice_rejected — show rejected SMS explicitly, non-chargeable
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS rejected INT NOT NULL DEFAULT 0;
