-- 034_invoice_payments — receiving accounts + per-invoice payment claims + paid tracking

CREATE TABLE IF NOT EXISTS system_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('bank','upi','usdt')),
  label TEXT NOT NULL,
  chain TEXT CHECK (chain IN ('TRC20','ERC20','BEP20','Polygon','Other') OR chain IS NULL),
  details JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_payment_methods_active ON system_payment_methods(is_active);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('bank','upi','usdt','wire','other')),
  chain TEXT CHECK (chain IN ('TRC20','ERC20','BEP20','Polygon','Other') OR chain IS NULL),
  details JSONB NOT NULL DEFAULT '{}',
  amount NUMERIC(18,6),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method TEXT
  CHECK (payment_method IN ('bank','upi','usdt','wire','other') OR payment_method IS NULL);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_chain TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES users(id);
