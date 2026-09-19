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
//
// Fortius note (verified 2026-09-19 against live http-dlr.php responses):
// Fortius returns NUMERIC per-message codes with `delvd_time` ALWAYS
// populated (IST, often the submit/attempt time — NOT proof of delivery).
// Live evidence: entries with status "2"/"3"/"4" ALL carry real timestamps,
// yet the vendor panel shows those messages failed / not received, and a
// prior manual correction ("code 4 is not delivered - handset never
// received it") confirms code 4 ≠ delivered. So for Fortius-style numeric
// statuses the timestamp is MEANINGLESS and must never force DELIVRD.
// Only an explicit delivered WORD ("delivered"/"delivrd"/"success") marks
// delivered. Everything else stays `submitted` (re-polled) with the raw code
// on messages.error_code as `poll:<raw>` for the operator.
// Word statuses (FAILED, REJECTD, UNDELIV, …) map normally via toStat.

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
  created_at: string;
}

/** HSP-style datewise report mode: the poll URL contains {date} (YYYY-MM-DD)
    instead of {msgid}, and returns per-number records like:
      [{"responseCode":"success","totalsize":"1","records":[
        {"mobile":"9157908291","status":"DELIVRD","senton":"19/09/2026 18:24:20",...}]}]
    Used when the vendor's send response carries no msgid (synthetic http-*
    ids) and their per-msgid endpoint can't correlate. Matching is by
    destination digits; the message's own send date picks the report day. */
function isReportMode(tpl: string): boolean {
  return tpl.includes('{date}');
}

function reportDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? vars[k]! : m,
  );
}

/** Vendor status WORD → classic DLR stat token.
    Numeric codes deliberately return UNKNOWN — see header. */
function toStat(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!s) return 'UNKNOWN';
  if (/^\d+$/.test(s)) return 'UNKNOWN';
  if (s.startsWith('DELIVRD') || s === 'DELIVERED' || s === 'DELIVERY_SUCCESS' || s === 'D') return 'DELIVRD';
  if (s.startsWith('EXPIRED') || s === 'EXPIRE') return 'EXPIRED';
  if (s.startsWith('UNDELIV') || s === 'UNDELIVERED' || s === 'FAILED_TEMP' || s === 'NDNC' || s === 'DND') return 'UNDELIV';
  if (s.startsWith('REJECTD') || s.startsWith('REJECT')) return 'REJECTD';
  if (s.startsWith('FAILED') || s === 'FAIL' || s === 'F') return 'FAILED';
  // DLT-style free-text failures (e.g. "Template Not Matched") — vendors that
  // reject on template/content grounds instead of a code.
  if (/TEMPLATE|MISMATCH|NOT APPROVED|NOT WHITELIST|BLACKLIST|BLOCKED|BARRED|INVALID/i.test(raw)) return 'FAILED';
  if (s.startsWith('ACCEPTD') || s.startsWith('ENROUTE') || s === 'SENT' || s === 'SUBMITTED' || s === 'PENDING' || s === 'P') return 'ACCEPTD';
  return 'UNKNOWN';
}

/** A real delivery timestamp from the vendor is ground truth for DELIVRD,
    independent of whatever status word/code accompanies it. Placeholders
    ("---", blank, null-like, zero dates) mean "not delivered yet". */
function hasDeliveryTime(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (!s) return false;
  const low = s.toLowerCase();
  if (low === '---' || low === '--' || low === '-' || low === 'null' || low === 'none' || low === 'n/a') return false;
  const digits = s.replace(/\D/g, '');
  if (!digits) return false; // no digits at all — can't be a timestamp
  if (/^0+$/.test(digits)) return false; // all-zero date like 00-00-0000
  if (/^00-00-0000/.test(s) || /^0000-00-00/.test(s)) return false;
  return true;
}

/** Parse a vendor delivery timestamp to epoch ms for ordering.
    Returns -1 when absent/placeholder, -0.5 when present but unparseable
    (still ranks above "no time" — presence alone proves delivery). */
function parseVendorTime(v: unknown): number {
  if (!hasDeliveryTime(v)) return -1;
  const s = String(v).trim();
  let m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const t = new Date(+m[3]!, +m[2]! - 1, +m[1]!, +m[4]!, +m[5]!, +(m[6] ?? 0)).getTime();
    return Number.isNaN(t) ? -0.5 : t;
  }
  m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const t = new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)).getTime();
    return Number.isNaN(t) ? -0.5 : t;
  }
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    return n < 1e12 ? n * 1000 : n; // epoch seconds → ms
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? -0.5 : t;
}

/** Case-insensitive field pick across common vendor spellings. */
function pickField(obj: Record<string, unknown>, names: string[]): unknown {
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) lower[k.toLowerCase()] = v;
  for (const n of names) {
    const v = lower[n.toLowerCase()];
    if (v !== undefined && v !== null && String(v) !== '') return v;
  }
  return undefined;
}

/** Normalize the many vendor envelope shapes into a flat entry list.
    Handles: [...] | {data:[...]} | {data:{...}} | {messages:[...]} |
    {dlr:[...]} | {result/report/reports:{...}} | {records:[...]} (HSP
    datewise: [{"responseCode":"success","records":[...]}]) |
    single {...} objects. */
function extractEntries(parsed: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(parsed)) {
    // Array envelope whose items THEMSELVES wrap record lists (HSP:
    // [{"responseCode":"success","records":[...]}]) — unwrap one level.
    const out: Array<Record<string, unknown>> = [];
    for (const it of parsed) {
      if (it !== null && typeof it === 'object' && !Array.isArray(it)) {
        const rec = (it as Record<string, unknown>).records;
        if (Array.isArray(rec)) {
          out.push(...(rec as Array<Record<string, unknown>>));
          continue;
        }
      }
      out.push(it as Record<string, unknown>);
    }
    return out;
  }
  if (parsed !== null && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    for (const key of ['data', 'messages', 'message', 'dlr', 'dlrs', 'result', 'report', 'reports', 'records']) {
      const v = o[key];
      if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
      if (v !== null && typeof v === 'object') return [v as Record<string, unknown>];
    }
    // Single-object DLR (status + optional time at top level)
    if (o.status !== undefined || o.dlr_status !== undefined || (o as Record<string, unknown>).delivery_status !== undefined) {
      return [o];
    }
  }
  return [];
}

/** Top-level error payloads (HTTP 200 with failure body) carry no per-message
    data — e.g. Fortius {"status":"false","code":"008",...}. */
function isErrorPayload(parsed: unknown): string | null {
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    const statusRaw = String(o.status ?? '');
    if (/^(false|fail|failed|error|0)$/i.test(statusRaw.trim())) {
      return `vendor error payload status=${statusRaw} code=${String(o.code ?? o.responseCode ?? '')}`;
    }
  }
  return null;
}

function dlrDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

function lastDigits(s: string, n = 10): string {
  return (s ?? '').replace(/\D/g, '').slice(-n);
}

const STATUS_FIELDS = ['dlr_status', 'status', 'delivery_status', 'state', 'delivery_state'];
const TIME_FIELDS = ['delvd_time', 'delv_time', 'delivered_time', 'delivered_at', 'done_date', 'delivery_time', 'delvdate'];

/** Stale-numeric guard: a bare numeric that never advances to a terminal
    state (Fortius "2" stuck while the vendor panel already shows FAILED)
    fails after this many consecutive polls instead of sitting `submitted`
    forever. Polls land ~1–2 min apart in practice, so 6 rounds ≈ 10 min.
    Tracked in messages.error_code as `poll:<code>#<n>` so the count
    survives restarts. */
const STALE_ROUNDS = 6;

/** Words that count as an explicit DELIVERED from a poll entry.
    Anything else — including bare numerics ("1".."7") even WITH a delivery
    timestamp — is not proof the handset received it. */
const EXPLICIT_DELIVERED_RE = /delivrd|delivered|delivery_success|\bsuccess\b|\bok\b|^d$/i;

/** Fortius numeric codebook (confirmed live 2026-09-19):
    - "4" = FAILED at the vendor (panel shows FAILED, handset never receives;
      prior manual correction "code 4 is not delivered" agrees).
    - "2"/"3" = accepted/in-flight at the vendor (panel keeps them pending;
      a wrong-template test sits at "2" while the vendor panel shows the
      send FAILED — the code never advances, so it must not sit `submitted`
      forever either; see the stale guard in pollOne).
    Only an explicit delivered WORD ever means delivered. */
const FORTIUS_FAILED_CODES = new Set(['4']);

/** Resolve a poll entry to a DLR stat token.
    - Word statuses map via toStat (FAILED/REJECTD/UNDELIV/EXPIRED/DELIVRD…).
    - Explicit delivered words (+ timestamp or not) → DELIVRD.
    - Fortius "4" → FAILED (vendor-confirmed failure code).
    - Other bare numerics / unrecognized → ACCEPTD when a delivery timestamp
      is present (in-flight, keep polling — the stale guard in pollOne fails
      them after N rounds with no terminal state), UNKNOWN otherwise.
      NEVER DELIVRD from a numeric: Fortius populates delvd_time on failed
      rows too, so the timestamp alone proves nothing. */
export function resolvePollStat(statusRaw: string, timeRaw: unknown): string {
  const stat = toStat(statusRaw);
  if (stat === 'DELIVRD') return 'DELIVRD';
  if (stat !== 'ACCEPTD' && stat !== 'UNKNOWN') return stat;
  if (EXPLICIT_DELIVERED_RE.test(statusRaw.trim())) return 'DELIVRD';
  if (FORTIUS_FAILED_CODES.has(statusRaw.trim())) return 'FAILED';
  if (hasDeliveryTime(timeRaw)) return 'ACCEPTD';
  return stat;
}

async function pollOne(
  vendorId: string, tpl: string, msg: PendingMsg,
): Promise<void> {
  const pool = getPool();

  // Report mode (HSP): match by destination in the datewise report — the
  // synthetic http-* id is irrelevant here, skip the msgid gate below.
  const reportMode = isReportMode(tpl);

  // Synthetic ids (http-<short>) mean the submit response carried no vendor
  // msgid — polling with a fake id can never match. Surface it on the message
  // so the operator fixes msgid_json_path instead of wondering why it sticks.
  // (Skipped in report mode: matching is by destination, not msgid.)
  if (!reportMode && (!msg.vendor_msg_id || msg.vendor_msg_id.startsWith('http-'))) {
    await pool.query(
      `UPDATE messages SET last_dlr_poll_at=now(),
         error_code=COALESCE(NULLIF(error_code,''),'poll:no-vendor-msgid')
       WHERE id=$1 AND (error_code IS NULL OR error_code='' OR error_code LIKE 'poll:%')`,
      [msg.id],
    );
    console.warn(`[dlr-poll] ${msg.id.slice(0, 8)} skipped — no vendor msgid (check msgid_json_path)`);
    return;
  }

  const url = reportMode
    ? fill(tpl, {
      msgid: msg.vendor_msg_id ?? '',
      to: msg.destination,
      date: reportDate(new Date(msg.created_at)),
    })
    : fill(tpl, { msgid: msg.vendor_msg_id, to: msg.destination });
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return; // non-JSON (e.g. "Invalid msgid") — try again next round
  }
  const errPayload = isErrorPayload(parsed);
  if (errPayload) {
    console.warn(`[dlr-poll] ${vendorId} ${msg.id.slice(0, 8)} ${errPayload}`);
    return;
  }
  const entries = extractEntries(parsed);
  if (!entries.length) return;

  // Vendors may reuse one msgid across numbers AND across sends (Fortius
  // returns several entries for the same id/mobile). Pick the entry for OUR
  // number with the LATEST delivery timestamp — a stale entry from an older
  // send must never shadow this message's own DLR.
  // Report mode (HSP): entries carry no msgid at all — destination match is
  // REQUIRED (no fallback to the whole pool: another number's DELIVRD must
  // never settle our row).
  const want = lastDigits(msg.destination);
  const byNumber = entries.filter((e) => {
    const mob = String(pickField(e, ['mobile', 'number', 'to', 'destination', 'phone']) ?? '');
    return mob && (lastDigits(mob) === want || mob.endsWith(want));
  });
  if (reportMode && !byNumber.length) {
    await pool.query('UPDATE messages SET last_dlr_poll_at=now() WHERE id=$1', [msg.id]);
    return; // our number not in this report slice yet — next round
  }
  const pool2 = byNumber.length ? byNumber : entries;
  const scored = pool2
    .map((e) => ({ e, t: parseVendorTime(pickField(e, TIME_FIELDS)) }))
    .sort((a, b) => b.t - a.t);
  const hit = scored.length === 1
    ? scored[0]!.e
    : (scored.find((s) => s.t >= 0)?.e
      ?? pool2.find((e) => String(pickField(e, ['id', 'msgid', 'message_id', 'msg_id']) ?? '') === msg.vendor_msg_id)
      ?? scored[0]!.e);

  if (!hit) return;
  const statusRaw = String(pickField(hit, STATUS_FIELDS) ?? '');
  const timeRaw = pickField(hit, TIME_FIELDS);

  // Only explicit delivered words (or mapped DELIVRD) close the loop.
  // Numerics with timestamps stay `submitted` — Fortius fills delvd_time on
  // failed rows too, so it proves nothing. internal_id + destination pin the
  // DLR to THIS message — vendors reusing msgids must not credit a sibling
  // row (dlr-worker prefers the direct hit over msgid lookup).
  const stat = resolvePollStat(statusRaw, timeRaw);
  if (stat === 'DELIVRD') {
    const now = dlrDate(new Date());
    const body =
      `id:${msg.vendor_msg_id} sub:001 dlvrd:001 submit date:${now} done date:${now} ` +
      `stat:DELIVRD err:000 text:`;
    await getQueue(QUEUES.dlr).add('dlr', {
      vendor_id: vendorId,
      body,
      source: '',
      received_at: new Date().toISOString(),
      internal_id: msg.id,
      destination: msg.destination,
    });
    return;
  }

  // Still in flight (or undocumented numeric without delivery time) → leave
  // `submitted`, next round will re-poll. Stash the raw code on the message so
  // the operator can see it in message detail / logs instead of guessing.
  // Stale guard: a numeric that never advances (e.g. Fortius "2" stuck while
  // the vendor panel already shows the send FAILED, as in wrong-template
  // tests) must not sit `submitted` forever. After STALE_ROUNDS consecutive
  // polls with no terminal state, fail it as vendor:stale-<code> so the panel
  // matches the vendor instead of hanging.
  if (stat === 'ACCEPTD' || stat === 'UNKNOWN') {
    const raw = statusRaw ? statusRaw.slice(0, 32) : 'empty';
    if (/^\d+$/.test(statusRaw.trim())) {
      // Bump the consecutive-stale counter kept in error_code (`poll:2#7`).
      // A code change resets it; reaching STALE_ROUNDS fails the message so
      // a stuck numeric (vendor already FAILED it) can't sit forever.
      const cur = await pool.query('SELECT error_code FROM messages WHERE id=$1', [msg.id])
        .then((x) => String(x.rows[0]?.error_code ?? '')).catch(() => '');
      const m = cur.match(/^poll:([^\s#]+)#(\d+)$/);
      const n = m && m[1] === raw ? Number(m[2]) + 1 : 1;
      if (n >= STALE_ROUNDS) {
        const now = dlrDate(new Date());
        const body =
          `id:${msg.vendor_msg_id} sub:001 dlvrd:001 submit date:${now} done date:${now} ` +
          `stat:FAILED err:000 text:`;
        await getQueue(QUEUES.dlr).add('dlr', {
          vendor_id: vendorId,
          body,
          source: '',
          received_at: new Date().toISOString(),
          internal_id: msg.id,
          destination: msg.destination,
        });
        await pool.query(
          `UPDATE messages SET error_code=$1 WHERE id=$2
           AND (error_code IS NULL OR error_code='' OR error_code LIKE 'poll:%')`,
          [`poll:${raw}#stale`, msg.id],
        ).catch(() => undefined);
        console.warn(`[dlr-poll] ${msg.id.slice(0, 8)} numeric status=${statusRaw} stale after ${n} rounds — failing`);
        return;
      }
      await pool.query(
        `UPDATE messages SET error_code=$1 WHERE id=$2
         AND (error_code IS NULL OR error_code='' OR error_code LIKE 'poll:%')`,
        [`poll:${raw}#${n}`, msg.id],
      ).catch(() => undefined);
      console.warn(`[dlr-poll] ${msg.id.slice(0, 8)} numeric status=${statusRaw} (${n}/${STALE_ROUNDS}) — leaving submitted`);
      return;
    }
    await pool.query(
      `UPDATE messages SET error_code=$1 WHERE id=$2
       AND (error_code IS NULL OR error_code='' OR error_code LIKE 'poll:%')`,
      [`poll:${raw}`, msg.id],
    ).catch(() => undefined);
    return;
  }

  const now = dlrDate(new Date());
  const body =
    `id:${msg.vendor_msg_id} sub:001 dlvrd:001 submit date:${now} done date:${now} ` +
    `stat:${stat} err:000 text:`;
  await getQueue(QUEUES.dlr).add('dlr', {
    vendor_id: vendorId,
    body,
    source: '',
    received_at: new Date().toISOString(),
    internal_id: msg.id,
    destination: msg.destination,
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
      `SELECT id, vendor_msg_id, destination, created_at FROM messages
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
