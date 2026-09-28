// Add INDIA SIM (Nukelite GSM) HTTP vendor — Himanshu1, TPS 1000.
const { Client } = require('./vps-debug/node_modules/ssh2');
const crypto = require('crypto');

const GSM_API_KEY = 'df5c7820c09b62e4dbfe99ee1d9cf29d78bfb655b781f8a1177cdf0e1a0f6002';
const GSM_HOST = 'nukelite.co.in';
const VENDOR_NAME = 'INDIA SIM';

function encKeyWith(raw) {
  return crypto.createHash('sha256').update(raw).digest();
}
function encryptSecretWith(raw, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKeyWith(raw), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
}
// legacy local helper (kept for non-VPS use)
function encryptSecret(plain) { return encryptSecretWith(process.env.VENDOR_SECRET_KEY || 'dev-vendor-key-please-change-32b!!', plain); }

const conn = new Client();
const run = (cmd, timeout = 120000) => new Promise((resolve) => {
  conn.exec(cmd, (err, stream) => {
    if (err) return resolve(`EXEC ERR: ${err.message}`);
    let out = '';
    const timer = setTimeout(() => resolve(`${out}\n[TIMEOUT after ${timeout}ms]`), timeout);
    stream.on('data', (d) => { out += d; });
    stream.stderr.on('data', (d) => { out += d; });
    stream.on('close', () => { clearTimeout(timer); resolve(out.trim()); });
  });
});

conn.on('ready', async () => {
  console.log('SSH OK — adding INDIA SIM vendor');
  // Fetch the REAL VENDOR_SECRET_KEY from the VPS so headers_enc decrypts there (dev key != VPS key).
  const vpsKeyRaw = await run('grep -m1 VENDOR_SECRET_KEY /opt/8xtelsmpp/.env 2>&1', 15000);
  const m = vpsKeyRaw.match(/VENDOR_SECRET_KEY\s*=\s*(\S+)/);
  const vpsKey = m ? m[1].trim() : (process.env.VENDOR_SECRET_KEY || 'dev-vendor-key-please-change-32b!!');
  if (!m) console.warn('WARN: could not read VPS VENDOR_SECRET_KEY, falling back to local key');
  const headersEnc = encryptSecretWith(vpsKey, JSON.stringify({ 'X-API-Key': GSM_API_KEY }));
  console.log('headers_enc', headersEnc.slice(0, 60) + '... (key ' + vpsKey.slice(0,8) + '...)');

  const sql = `
    cd /opt/8xtelsmpp && docker compose exec -T postgres psql -U xtel -d xtelsmpp <<'PSQLEOF'
BEGIN;
INSERT INTO vendors (name, host, port, system_id, password_enc, bind_type, source_ton, source_npi, dest_ton, dest_npi, tps, protocol, connection_count, dlr_supported, synthetic_dlr_enabled, use_tls, status, reconnect_interval_sec, sender_id_rule)
SELECT 'INDIA SIM','nukelite.co.in',443,'india-sim-gsm','http-vendor-no-smpp-login','transceiver',0,1,0,1,1000,'http',1,true,false,true,'enabled',10,'passthrough'
WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE name='INDIA SIM');
UPDATE vendors SET tps=1000, protocol='http', status='enabled', host='nukelite.co.in', port=443, use_tls=true, updated_at=now() WHERE name='INDIA SIM';
WITH vid AS (SELECT id FROM vendors WHERE name='INDIA SIM' LIMIT 1)
INSERT INTO vendor_http_configs (vendor_id, url_template, method, body_template, headers_enc, msgid_json_path, timeout_ms, verify_tls, dlr_poll_url_template, dlr_poll_interval_sec, force_sender_id, message_template, updated_at)
SELECT id,'https://nukelite.co.in/api/ext/gsm/campaigns','POST','{"name":"{msg_id}","numbers":["{to}"],"message":"{text}","sms_type":"normal"}','${headersEnc}','campaign_id',10000,true,'https://nukelite.co.in/api/ext/gsm/campaigns/{msgid}/report',5,NULL,NULL,now() FROM vid
ON CONFLICT (vendor_id) DO UPDATE SET url_template=EXCLUDED.url_template, method=EXCLUDED.method, body_template=EXCLUDED.body_template, headers_enc=EXCLUDED.headers_enc, msgid_json_path=EXCLUDED.msgid_json_path, timeout_ms=EXCLUDED.timeout_ms, verify_tls=EXCLUDED.verify_tls, dlr_poll_url_template=EXCLUDED.dlr_poll_url_template, dlr_poll_interval_sec=EXCLUDED.dlr_poll_interval_sec, updated_at=now();
DELETE FROM vendor_connections WHERE vendor_id=(SELECT id FROM vendors WHERE name='INDIA SIM');
COMMIT;
SELECT v.id, v.name, v.protocol, v.tps, v.status, c.url_template, c.msgid_json_path, c.dlr_poll_url_template, c.dlr_poll_interval_sec, (c.headers_enc IS NOT NULL) as has_headers FROM vendors v LEFT JOIN vendor_http_configs c ON c.vendor_id=v.id WHERE v.name='INDIA SIM';
PSQLEOF
  `;
  console.log(await run(sql, 30000));
  console.log('\n--- app build + restart (picks up http-sender + dlr-poller patch) ---');
  console.log(await run('cd /opt/8xtelsmpp && docker compose up -d --build vendor-worker 2>&1 | tail -20', 300000));
  console.log(await run('cd /opt/8xtelsmpp && docker compose logs --tail=20 vendor-worker 2>&1 | tail -20', 15000));
  console.log('\n=== INDIA SIM live ===');
  console.log('- Send: POST https://nukelite.co.in/api/ext/gsm/campaigns  (X-API-Key: Himanshu1)');
  console.log('- DLR:  GET  .../campaigns/{campaign_id}/report  (every 5s, status sent→DELIVRD)');
  console.log('- Numbers: without 91 (stripped in http-sender)');
  conn.end();
}).on('error', (e) => { console.error('SSH FAILED:', e.message); process.exit(1); }).connect({ host: '187.127.176.92', username: 'root', password: 'Yoyoeraisback@2026', readyTimeout: 20000 });
