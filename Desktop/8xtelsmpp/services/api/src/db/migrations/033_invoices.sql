-- 033_invoices — invoice & billing suite (§28, §29)

CREATE TABLE IF NOT EXISTS invoice_counters (
  ym TEXT PRIMARY KEY,
  next_seq INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  invoice_number TEXT UNIQUE NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  subtotal NUMERIC(18,6) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  adjustments NUMERIC(18,6) NOT NULL DEFAULT 0,
  grand_total NUMERIC(18,6) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'generated'
    CHECK (status IN ('draft','generated','sent','paid','unpaid','overdue','cancelled')),
  notes TEXT,
  generated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_client_period ON invoices (client_id, period_from);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (status);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  country_id UUID REFERENCES countries(id),
  country_name TEXT NOT NULL DEFAULT 'Unknown',
  iso_code CHAR(2),
  total_sms INT NOT NULL DEFAULT 0,
  successful INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  segments INT NOT NULL DEFAULT 0,
  rate NUMERIC(18,6) NOT NULL DEFAULT 0,
  amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  percentage NUMERIC(5,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines (invoice_id);

CREATE TABLE IF NOT EXISTS invoice_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now(),
  sent_by UUID REFERENCES users(id),
  message_id TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoice_emails_invoice ON invoice_emails (invoice_id);
