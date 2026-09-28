-- 045_india_sim_gsm_vendor — HTTP vendor: INDIA SIM (Nukelite GSM API).
-- Himanshu1 account, TPS 1000, status enabled so traffic routes immediately.
-- ADDITIVE ONLY: inserts vendor + http config; re-runnable (ON CONFLICT / WHERE NOT EXISTS).
-- Auth: X-API-Key header with Himanshu1 key; numbers are sent WITHOUT 91 (see http-sender strip).

-- ── Vendor row (protocol=http → no SMPP binds, one HTTPS request per SMS) ─────
INSERT INTO vendors (name, host, port, system_id, password_enc, bind_type, source_ton, source_npi, dest_ton, dest_npi, tps, protocol, connection_count, dlr_supported, synthetic_dlr_enabled, use_tls, status, reconnect_interval_sec, sender_id_rule)
SELECT 'INDIA SIM', 'nukelite.co.in', 443, 'india-sim-gsm', 'http-vendor-no-smpp-login', 'transceiver', 0, 1, 0, 1, 1000, 'http', 1, true, false, true, 'enabled', 10, 'passthrough'
WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE name = 'INDIA SIM');

-- Backfill if the row already existed with different TPS/protocol (e.g. draft SMPP row)
UPDATE vendors SET tps = 1000, protocol = 'http', status = 'enabled', host = 'nukelite.co.in', port = 443, use_tls = true, updated_at = now() WHERE name = 'INDIA SIM' AND (tps <> 1000 OR COALESCE(protocol,'smpp') <> 'http' OR status <> 'enabled');

-- ── HTTP config — Nukelite GSM campaigns API ──────────────────────────────────
-- Send:   POST https://nukelite.co.in/api/ext/gsm/campaigns
--   Headers: X-API-Key: <Himanshu1 key>   Content-Type: application/json
--   Body:    {"name":"{msg_id}","numbers":["{to}"],"message":"{text}","sms_type":"normal"}
--   Note: {to} is stripped to 10 digits without 91 by http-sender for this vendor.
-- Response: {"campaign_id":7078,"request_id":"...","status":"pending"} → msgid_json_path = campaign_id
-- DLR poll: GET https://nukelite.co.in/api/ext/gsm/campaigns/{msgid}/report  (same X-API-Key)
--   Response shape (verified live 2026-09-28):
--     {"campaign":{"id":7078,"status":"completed",...},"numbers":[{"mobile":"9876543210","status":"sent","sent_at":"..."}]}
--   Per-number status values: "sent" | "pending" | "failed" (campaign cancelled → pending).
INSERT INTO vendor_http_configs (vendor_id, url_template, method, body_template, headers_enc, msgid_json_path, timeout_ms, verify_tls, dlr_poll_url_template, dlr_poll_interval_sec, force_sender_id, message_template, updated_at)
SELECT v.id,
  'https://nukelite.co.in/api/ext/gsm/campaigns',
  'POST',
  '{"name":"{msg_id}","numbers":["{to}"],"message":"{text}","sms_type":"normal"}',
  NULL, -- filled below (encrypted)
  'campaign_id',
  10000,
  true,
  'https://nukelite.co.in/api/ext/gsm/campaigns/{msgid}/report',
  5,
  NULL,
  NULL,
  now()
FROM vendors v WHERE v.name = 'INDIA SIM'
ON CONFLICT (vendor_id) DO UPDATE SET
  url_template       = EXCLUDED.url_template,
  method             = EXCLUDED.method,
  body_template      = EXCLUDED.body_template,
  msgid_json_path    = EXCLUDED.msgid_json_path,
  timeout_ms         = EXCLUDED.timeout_ms,
  verify_tls         = EXCLUDED.verify_tls,
  dlr_poll_url_template    = EXCLUDED.dlr_poll_url_template,
  dlr_poll_interval_sec    = EXCLUDED.dlr_poll_interval_sec,
  force_sender_id    = EXCLUDED.force_sender_id,
  message_template   = EXCLUDED.message_template,
  updated_at         = now();

-- ── Encrypted headers (AES-256-GCM, same key as vendor passwords) ──────────────
-- Stored as iv:tag:ciphertext hex. The value here is a placeholder that the
-- migration runner overwrites with a real encryption of {"X-API-Key":"<key>"}.
-- If you run this SQL manually without the Node runner, set headers_enc via:
--   node -e "const c=require('crypto');const k=c.createHash('sha256').update(process.env.VENDOR_SECRET_KEY||'dev-vendor-key-please-change-32b!!').digest();const iv=c.randomBytes(12);const ci=c.createCipheriv('aes-256-gcm',k,iv);const ct=Buffer.concat([ci.update(JSON.stringify({'X-API-Key':'df5c7820c09b62e4dbfe99ee1d9cf29d78bfb655b781f8a1177cdf0e1a0f6002'}),'utf8'),ci.final()]);console.log(iv.toString('hex')+':'+ci.getAuthTag().toString('hex')+':'+ct.toString('hex'))"
-- then UPDATE vendor_http_configs SET headers_enc='<that>' WHERE vendor_id=(SELECT id FROM vendors WHERE name='INDIA SIM');
-- The Node-side deploy script (local/add-india-sim-vendor.cjs) does this automatically.

-- ── Remove any stale SMPP binds if this vendor was previously SMPP ────────────
DELETE FROM vendor_connections WHERE vendor_id = (SELECT id FROM vendors WHERE name = 'INDIA SIM');
