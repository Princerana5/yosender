import express, { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { queryOne, getQueue, QUEUES } from '@8xtel/core';

const router = Router();

// ── Inbound DLR webhook from HTTP vendors ────────────────────────────────────
// Vendor: POST /vendor-dlr/:token  { message_id, status }
//   message_id = the id OUR submit received back from their API (or the
//                synthetic http-<short> id when their API returns none).
//   status     = delivered | undelivered | expired | rejected | failed
//                (also accepts common aliases: DELIVRD, UNDELIV, REJECTD…)
// Auth = the token itself (unguessable 192-bit value, revocable per vendor).
// The payload is normalized into the classic `id:… stat:…` DLR text and
// pushed onto sms:dlr — from there the EXISTING dlr-worker handles mapping,
// panel storage, billing settlement and client fan-out with zero changes.
//
// NOTE: mounted WITHOUT requireAuth (public, token-authenticated). Rate
// limiting comes from the global express-rate-limit (600 req/min).

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const TOKEN_RE = /^[A-Za-z0-9_-]{10,128}$/;

const dlrSchema = z.object({
  message_id: z.string().min(1).max(128),
  status: z.string().min(1).max(32),
  error_code: z.string().max(16).nullable().optional(),
});

function normalizeStatus(raw: string): string {
  const s = raw.trim().toUpperCase();
  // Fortis/Fortius-style numeric push codes: "4" = vendor-confirmed failure.
  // Other bare numerics are in-flight → UNKNOWN (ignored, poller keeps polling).
  if (/^\d+$/.test(s)) return s === '4' ? 'FAILED' : 'UNKNOWN';
  if (s.startsWith('DELIVRD') || s === 'DELIVERED' || s === 'DELIVERY_SUCCESS' || s === 'D') return 'DELIVRD';
  if (s.startsWith('EXPIRED') || s === 'EXPIRE') return 'EXPIRED';
  if (s.startsWith('UNDELIV') || s === 'UNDELIVERED' || s === 'FAILED_TEMP' || s === 'NDNC' || s === 'DND') return 'UNDELIV';
  if (s.startsWith('REJECTD') || s.startsWith('REJECT')) return 'REJECTD';
  if (s.startsWith('FAILED') || s === 'FAIL' || s === 'F') return 'FAILED';
  if (/TEMPLATE|MISMATCH|NOT APPROVED|NOT WHITELIST|BLACKLIST|BLOCKED|BARRED|INVALID/i.test(raw)) return 'FAILED';
  if (s.startsWith('ACCEPTD') || s.startsWith('ENROUTE') || s === 'SENT' || s === 'SUBMITTED' || s === 'PENDING' || s === 'P') return 'ACCEPTD';
  return 'UNKNOWN';
}

function dlrDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

router.post('/:token', handleVendorDlr);
router.get('/:token', handleVendorDlr);

async function handleVendorDlr(req: express.Request, res: express.Response): Promise<void> {
  const token = req.params.token;
  if (!TOKEN_RE.test(token)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const row = await queryOne<{ vendor_id: string }>(
    'SELECT vendor_id FROM vendor_dlr_tokens WHERE token_hash=$1', [hashToken(token)],
  );
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  // Flexible payload: vendors push in wildly different shapes —
  //   JSON {message_id,status} | {msgid,dlr_status} | {id,delivery_status}
  //   GET ?msgid=X&status=DELIVRD | ?id=X&stat=D | form-encoded equivalents
  // Merge query + body so GET and POST both work.
  const merged: Record<string, unknown> = {
    ...(req.query as Record<string, unknown>),
    ...((req.body ?? {}) as Record<string, unknown>),
  };
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merged)) lower[k.toLowerCase()] = v;
  const pick = (...names: string[]): unknown => {
    for (const n of names) {
      const v = lower[n.toLowerCase()];
      if (v !== undefined && v !== null && String(v) !== '') return v;
    }
    return undefined;
  };
  const parsed = dlrSchema.safeParse({
    message_id: String(pick('message_id', 'msgid', 'msg_id', 'messageid', 'id', 'smsid', 'sms_id', 'requestid', 'request_id') ?? ''),
    status: String(pick('status', 'dlr_status', 'delivery_status', 'state', 'delivery_state', 'stat', 'dlr', 'report') ?? ''),
    error_code: (() => {
      const v = pick('error_code', 'errorcode', 'err', 'error', 'code', 'reason');
      return v === undefined ? undefined : String(v).slice(0, 16);
    })(),
  });
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.flatten() });
    return;
  }
  const stat = normalizeStatus(parsed.data.status);
  // ACCEPTD/UNKNOWN = not terminal — acknowledge receipt but don't touch the
  // message; the HTTP poller keeps polling until a real final state arrives.
  if (stat === 'ACCEPTD' || stat === 'UNKNOWN') {
    res.json({ ok: true, ignored: stat });
    return;
  }
  const now = dlrDate(new Date());
  // Classic DLR text — identical shape to an SMPP deliver_sm body, so
  // parseDlrBody/mapDlrStatus in dlr-worker handle it with no changes.
  const body =
    `id:${parsed.data.message_id} sub:001 dlvrd:001 submit date:${now} done date:${now} ` +
    `stat:${stat} err:${parsed.data.error_code ?? '000'} text:`;
  await getQueue(QUEUES.dlr).add('dlr', {
    vendor_id: row.vendor_id,
    body,
    source: '',
    received_at: new Date().toISOString(),
  });
  res.json({ ok: true });
}

export default router;
