-- 036_invoice_mail_extras — cc/bcc/subject on invoice_emails + make notes editable
ALTER TABLE invoice_emails ADD COLUMN IF NOT EXISTS cc TEXT;
ALTER TABLE invoice_emails ADD COLUMN IF NOT EXISTS bcc TEXT;
ALTER TABLE invoice_emails ADD COLUMN IF NOT EXISTS subject TEXT;
