import { getPool, getQueue, QUEUES, query } from '@8xtel/core';

// ── HTTP DLR poller (pull-style vendors, e.g. SamparkHub http-dlr.php) ─────────
// Some HTTP vendors offer no push webhook — only a status URL like:
//   https://sms.samparkhub.com/V2/http-dlr.php?apikey=XXX&msgid={msgid}&format=json
// returning e.g.:
//   {"status":"Success","code":"004","data":[
//     {"id":"MzQz","mobile":"XXXXXXXXXX","status":"delivered","delvd_time":"..."},
//     {"id":"MzQz","mobile":"XXXXXXXXXX","status":"submitted","delvd_time":"---"}]}
//
// Every interval, per HTTP vendor with dlr_poll_url_template set, we take a
// batch of still-`submitted` messages and poll once each. Results are
// normalized into the classic `id:… stat:…` DLR text and pushed onto sms:dlr —
// from there the EXISTING dlr-worker handles mapping, storage, billing
// settlement and client fan-out with zero changes.

interface PollVendor {
  vendor_id: string;
  vendor_name: string;
  dlr_poll_url_template: string;
  dlr_poll_interval_sec: number;
}

interface PendingMsg {
  id: string;
  vendor_msg_id: string;
  destination: string;
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? vars[k]! : m,
  );
}

/** Vendor status word → classic DLR stat token.
    NOTE: Fortius http-dlr.php returns NUMERIC codes ("1".."7") whose meanings
    are undocumented — they are deliberately NOT mapped here. A numeric code
    returns UNKNOWN so the message stays `submitted` (honest) instead of a
    guessed terminal state. The raw code is logged per poll; once Fortius
    support confirms the codebook, add the mapping here. */
function toStat(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (/^\d+$/.test(s)) {
    console.warn(`[dlr-poll] unmapped numeric status=${s} — leaving submitted, confirm codebook with vendor`);
    return 'UNKNOWN';
  }
  if (s.startsWith('DELIVRD') || s === 'DELIVERED' || s === 'DELIVERY_SUCCESS' || s === 'D') return 'DELIVRD';
  if (s.startsWith('EXPIRED') || s === 'EXPIRE') return 'EXPIRED';
  if (s.startsWith('UNDELIV') || s === 'UNDELIVERED' || s === 'FAILED_TEMP' || s === 'NDNC' || s === 'DND') return 'UNDELIV';
  if (s.startsWith('REJECTD') || s.startsWith('REJECT')) return 'REJECTD';
  if (s.startsWith('FAILED') || s === 'FAIL' || s === 'F') return 'FAILED';
  if (s.startsWith('ACCEPTD') || s.startsWith('ENROUTE') || s === 'SENT' || s === 'SUBMITTED' || s === 'PENDING' || s === 'P') return 'ACCEPTD';
  return 'UNKNOWN';
}

function dlrDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

function lastDigits(s: string, n = 10): string {
  return (s ?? '').replace(/\D/g, '').slice(-n);
}

async function pollOne(
  vendorId: string, tpl: string, msg: PendingMsg,
): Promise<void> {
  const pool = getPool();
  const url = fill(tpl, { msgid: msg.vendor_msg_id, to: msg.destination });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    await pool.query('UPDATE messages SET last_dlr_poll_at=now() WHERE id=$1', [msg.id]);
    console.warn(`[dlr-poll] ${vendorId} ${msg.id.slice(0, 8)} unreachable: ${(e as Error).message}`);
    return;
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => '');
  await pool.query('UPDATE messages SET last_dlr_poll_at=now() WHERE id=$1', [msg.id]);
  if (!res.ok) {
    console.warn(`[dlr-poll] ${vendorId} status=${res.status} for ${msg.id.slice(0, 8)}`);
    return;
  }
  let entries: Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(text) as { data?: unknown };
    const d = parsed?.data;
    entries = Array.isArray(d) ? d : d ? [d as Record<string, unknown>] : [];
  } catch {
    return; // non-JSON (e.g. "Invalid msgid") — try again next round
  }
  if (!entries.length) return;

  // Batch sends share one msgid across numbers — match by mobile suffix.
  const want = lastDigits(msg.destination);
  const hit = entries.length === 1
    ? entries[0]!
    : entries.find((e) => lastDigits(String(e.mobile ?? '')) === want
      || String(e.mobile ?? '').endsWith(want))
    ?? entries.find((e) => String(e.id ?? '') === msg.vendor_msg_id);

  if (!hit) return;
  const stat = toStat(String(hit.status ?? ''));
  // Still in flight → leave `submitted`, next round will re-poll.
  if (stat === 'ACCEPTD' || stat === 'UNKNOWN') return;

  const now = dlrDate(new Date());
  const body =
    `id:${msg.vendor_msg_id} sub:001 dlvrd:001 submit date:${now} done date:${now} ` +
    `stat:${stat} err:000 text:`;
  await getQueue(QUEUES.dlr).add('dlr', {
    vendor_id: vendorId,
    body,
    source: '',
    received_at: new Date().toISOString(),
  });
}

async function tick(): Promise<void> {
  const vendors = await query<PollVendor>(
    `SELECT v.id AS vendor_id, v.name AS vendor_name,
            c.dlr_poll_url_template, COALESCE(c.dlr_poll_interval_sec, 30) AS dlr_poll_interval_sec
     FROM vendors v JOIN vendor_http_configs c ON c.vendor_id = v.id
     WHERE COALESCE(v.protocol, 'smpp') = 'http' AND v.status = 'enabled'
       AND c.dlr_poll_url_template IS NOT NULL AND c.dlr_poll_url_template <> ''`,
  );
  for (const v of vendors) {
    const interval = Math.max(10, v.dlr_poll_interval_sec || 30);
    const pending = await query<PendingMsg>(
      `SELECT id, vendor_msg_id, destination FROM messages
       WHERE vendor_id = $1 AND status = 'submitted'
         AND vendor_msg_id IS NOT NULL AND vendor_msg_id <> ''
         AND (last_dlr_poll_at IS NULL OR last_dlr_poll_at < now() - ($2 || ' seconds')::interval)
         AND created_at > now() - interval '48 hours'
       ORDER BY last_dlr_poll_at NULLS FIRST, created_at LIMIT 50`,
      [v.vendor_id, String(interval)],
    );
    for (const m of pending) {
      try {
        await pollOne(v.vendor_id, v.dlr_poll_url_template, m);
      } catch (e) {
        console.error('[dlr-poll] failed', (e as Error).message);
      }
    }
    if (pending.length) console.log(`[dlr-poll] ${v.vendor_name}: polled ${pending.length}`);
  }
}

/** Start the periodic poll loop. Safe to call once from vendor-worker main. */
export function startDlrPoller(): void {
  const loop = (): void => {
    tick().catch((e) => console.error('[dlr-poll] tick failed', (e as Error).message));
  };
  setTimeout(loop, 10_000); // let binds settle first
  setInterval(loop, 30_000).unref();
}
