-- 046_fortis_india_vendor — HTTP vendor: Fortis India (smsfortius.work V2 API).
-- API key: H3UWbcfmV23kxIB5
-- ADDITIVE ONLY: re-runnable.
-- Send:   GET https://smsfortius.work/V2/?apikey=XXX&senderid={from}&number={to}&message={text}&format=json
--         (&templateid= auto-matched by vendor if omitted; add per-SID via vendor_sender_templates if needed)
-- Response: {"status":"Success","code":"011","data":{"messageid":"...","totnumber":"1",...}} → msgid_json_path = data.messageid
-- DLR:    GET https://smsfortius.work/V2/http-dlr.php?apikey=XXX&msgid={msgid}&format=json
--   {"status":"Success","code":"004","data":[{"mobile":"917...","status":"delivered","delvd_time":"01-01-2019 23:59:58"}, ...]}
--   status values: delivered (→ DELIVRD, real carrier DLR) / submitted (→ keep polling) / failed etc.
--   NOTE: Fortis populates delvd_time even on failed rows — timestamp alone is NOT proof. Only "delivered"
--   word or Fortis code 3 counts as delivered (handled in dlr-poller.ts — no fake DLR).

INSERT INTO vendors (name, host, port, system_id, password_enc, bind_type, source_ton, source_npi, dest_ton, dest_npi, tps, protocol, connection_count, dlr_supported, synthetic_dlr_enabled, use_tls, status, reconnect_interval_sec, sender_id_rule)
SELECT 'Fortis India', 'smsfortius.work', 443, 'fortis-india', 'http-vendor-no-smpp-login', 'transceiver', 0, 1, 0, 1, 200, 'http', 1, true, false, true, 'enabled', 10, 'passthrough'
WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE name = 'Fortis India');

UPDATE vendors SET tps = 200, protocol = 'http', status = 'enabled', host = 'smsfortius.work', port = 443, use_tls = true, updated_at = now()
WHERE name = 'Fortis India' AND (tps <> 200 OR COALESCE(protocol,'smpp') <> 'http' OR status <> 'enabled');

INSERT INTO vendor_http_configs (vendor_id, url_template, method, body_template, headers_enc, msgid_json_path, timeout_ms, verify_tls, dlr_poll_url_template, dlr_poll_interval_sec, force_sender_id, message_template, updated_at)
SELECT v.id,
  'https://smsfortius.work/V2/?apikey=H3UWbcfmV23kxIB5&senderid={from}&number={to}&message={text}&format=json',
  'GET',
  NULL,
  NULL,
  'data.messageid',
  10000,
  true,
  'https://smsfortius.work/V2/http-dlr.php?apikey=H3UWbcfmV23kxIB5&msgid={msgid}&format=json',
  5,
  NULL,
  NULL,
  now()
FROM vendors v WHERE v.name = 'Fortis India'
ON CONFLICT (vendor_id) DO UPDATE SET
  url_template       = EXCLUDED.url_template,
  method             = EXCLUDED.method,
  body_template      = EXCLUDED.body_template,
  headers_enc        = EXCLUDED.headers_enc,
  msgid_json_path    = EXCLUDED.msgid_json_path,
  timeout_ms         = EXCLUDED.timeout_ms,
  verify_tls         = EXCLUDED.verify_tls,
  dlr_poll_url_template    = EXCLUDED.dlr_poll_url_template,
  dlr_poll_interval_sec    = EXCLUDED.dlr_poll_interval_sec,
  force_sender_id    = EXCLUDED.force_sender_id,
  message_template   = EXCLUDED.message_template,
  updated_at         = now();

DELETE FROM vendor_connections WHERE vendor_id = (SELECT id FROM vendors WHERE name = 'Fortis India');
