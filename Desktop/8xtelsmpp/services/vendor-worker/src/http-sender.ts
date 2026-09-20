import crypto from 'node:crypto';
import { queryOne, query, getPool } from '@8xtel/core';
import { decryptSecret } from './connector.js';

// ── HTTP upstream vendor sender ─────────────────────────────────────────────
// Same submit() shape as VendorConnector.submit() so the vendor-worker can
// treat SMPP and HTTP vendors identically: routing, failover chains, TPS
// guard, billing and retries all work unchanged. No SMPP bind involved —
// one HTTPS request per message.
//
// URL/body templates support placeholders:
//   {to} {from} {text} {msg_id} {dlr_url}
// {dlr_url} points at our inbound webhook (POST /vendor-dlr/:token) so the
// vendor can push delivery reports; vendors that only offer status-polling
// are covered by the poller (see below).
//
// Forced SID + template (§16): when force_sender_id is set it replaces the
// client sender for {from}; when message_template is set the upstream text is
// built from it, filling {v1} {v2} … from the client message split on "|"
// (e.g. client sends "2026|31st Dec|late|mdrt.org" → template vars filled).
// When either is blank, passthrough — client sender + text go as-is.

interface HttpConfig {
  url_template: string;
  method: string;
  body_template: string | null;
  headers_enc: string | null;
  msgid_json_path: string | null;
  timeout_ms: number;
  verify_tls: boolean;
  force_sender_id: string | null;
  message_template: string | null;
}

export interface HttpSubmitOpts {
  source: string;
  destination: string;
  text: string;
  internal_id: string;
  dlr_token: string | null;
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? vars[k]! : m,
  );
}

/** URL-template fill: values are encodeURIComponent'd (their PHP doc does
    urlencode($message) before building the URL — raw spaces/unicode/& in
    {text} would otherwise break the GET request). */
function fillUrl(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? encodeURIComponent(vars[k]!) : m,
  );
}

function pickPath(obj: unknown, path: string): unknown {
  // Supports array indices: "0.msgid" reads obj[0].msgid (HSP returns
  // [{"msgid":"..."}]). A bare numeric path ("0") reads obj[0] itself.
  return path.split('.').reduce<unknown>((acc, k) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc)) {
      if (/^\d+$/.test(k)) return acc[Number(k)];
      // Non-numeric key on an array: try the first element (single-item
      // vendor envelopes like [{"msgid":"x"}] with path "msgid").
      const first = acc[0] as Record<string, unknown> | undefined;
      return first !== null && typeof first === 'object' ? first[k] : undefined;
    }
    if (typeof acc === 'object') return (acc as Record<string, unknown>)[k];
    return undefined;
  }, obj);
}

function webhookBase(): string {
  // Public base URL the vendor uses to reach our DLR webhook. Falls back to
  // the SMPP public host over https; override with HTTP_DLR_BASE in .env.
  const base = process.env.HTTP_DLR_BASE
    ?? (process.env.SMPP_PUBLIC_HOST ? `https://${process.env.SMPP_PUBLIC_HOST}` : '');
  return base.replace(/\/$/, '');
}

export class HttpVendorSender {
  /** Always "connected" when config exists — no persistent socket to track. */
  connected = true;

  constructor(private vendorId: string, private vendorName: string) {}

  get index(): number {
    return 0;
  }

  private async loadConfig(): Promise<HttpConfig | null> {
    return queryOne<HttpConfig>(
      `SELECT url_template, method, body_template, headers_enc,
              msgid_json_path, timeout_ms, verify_tls,
              force_sender_id, message_template
       FROM vendor_http_configs WHERE vendor_id=$1`,
      [this.vendorId],
    );
  }

  /** Build the upstream sender + text.
      1. Per-SID templates (vendor_sender_templates): match the client sender
         case-insensitively; on no match the default row wins. The matched
         row's sender_id + template always go upstream — the vendor only ever
         sees an approved SID with its matching template.
      2. Legacy single forced SID (vendor_http_configs.force_sender_id): used
         only when the vendor has zero per-SID rows.
      3. Otherwise passthrough — client sender + text go as-is. */
  private async applyTemplate(cfg: HttpConfig, source: string, text: string): Promise<{ from: string; text: string }> {
    const rows = await query<{ sender_id: string; template: string; is_default: boolean }>(
      `SELECT sender_id, template, is_default FROM vendor_sender_templates
       WHERE vendor_id=$1 ORDER BY is_default DESC, sender_id`,
      [this.vendorId],
    );
    if (rows.length) {
      const hit = rows.find((r) => r.sender_id.toUpperCase() === source.toUpperCase())
        ?? rows.find((r) => r.is_default)
        ?? rows[0]!;
      return { from: hit.sender_id, text: this.fillVars(hit.template, text) };
    }
    const from = cfg.force_sender_id?.trim() ? cfg.force_sender_id.trim() : source;
    const tpl = cfg.message_template?.trim();
    if (!tpl) return { from, text };
    return { from, text: this.fillVars(tpl, text) };
  }

  /** Fill {v1} {v2} … from the client message split on "|".
      Missing vars stay literal so a plain (non-piped) message still goes out
      rather than erroring. */
  private fillVars(tpl: string, text: string): string {
    const parts = text.split('|').map((p) => p.trim());
    const vars: Record<string, string> = {};
    parts.forEach((p, i) => { vars[`v${i + 1}`] = p; });
    return fill(tpl, vars);
  }

  /** Submit one SMS via the vendor HTTP API. Resolves with vendor message id. */
  async submit(opts: HttpSubmitOpts): Promise<string> {
    const cfg = await this.loadConfig();
    if (!cfg) throw new Error(`no http config for vendor ${this.vendorName}`);
    const timeoutMs = cfg.timeout_ms > 0 ? cfg.timeout_ms : 10_000;

    const applied = await this.applyTemplate(cfg, opts.source, opts.text);
    // ── HTTP-only template gate: never send unapproved content upstream ──
    // Some HTTP vendors accept ANY content with HTTP 200 then report DELIVRD
    // for messages they silently drop (wrong template = handset gets nothing
    // but DLR says delivered). When this vendor uses per-SID templates, the
    // upstream text must be fully resolved: any leftover {vN} placeholder
    // means the client didn't supply the template variables → reject HERE
    // (failover engages) instead of letting the vendor fake a DELIVRD.
    // SMPP vendors are untouched — this runs inside HttpVendorSender only.
    if (/\{v\d+\}/i.test(applied.text)) {
      throw new Error(
        `http vendor rejected: template variables missing for sender ${applied.from} (unresolved ${applied.text.match(/\{v\d+\}/i)?.[0]})`,
      );
    }
    // Multi-SID mode: does this vendor use per-SID templates? When yes the
    // resolved `from` MUST win even if the operator left a hardcoded SID in
    // the URL/body template (e.g. sendername=NDRTEd). Otherwise every message
    // goes out from the old SID no matter which template was picked.
    const senderRows = await query<{ id: string }>(
      `SELECT id FROM vendor_sender_templates WHERE vendor_id=$1 LIMIT 1`,
      [this.vendorId],
    );
    const multiSid = senderRows.length > 0;
    const vars: Record<string, string> = {
      to: opts.destination,
      from: applied.from,
      text: applied.text,
      msg_id: opts.internal_id,
      dlr_url: opts.dlr_token ? `${webhookBase()}/vendor-dlr/${opts.dlr_token}` : '',
    };
    // GET vendors (e.g. SamparkHub V2) take params in the URL — encode values
    // like their PHP doc's urlencode($message). POST vendors keep raw values
    // for the JSON body template below.
    const isGet = (cfg.method ?? 'POST').toUpperCase() === 'GET';
    let url = (isGet ? fillUrl : fill)(cfg.url_template, vars).replace(
      /\{dlr_url\}/g, isGet ? encodeURIComponent(vars.dlr_url ?? '') : (vars.dlr_url ?? ''),
    );
    const method = isGet ? 'GET' : 'POST';
    // Multi-SID override: rewrite a hardcoded SID left in the URL (e.g.
    // sendername=NDRTEd) to the resolved template SID so traffic follows the
    // picked template. Matches common upstream param names, case-insensitive.
    if (multiSid) {
      const encFrom = encodeURIComponent(applied.from);
      const sidParam = /([?&](?:sendername|senderid|sender_id|sender|from|source|header)=)([^&]*)/i;
      if (sidParam.test(url)) url = url.replace(sidParam, `$1${encFrom}`);
    }

    let headers: Record<string, string> = { 'content-type': 'application/json' };
    if (cfg.headers_enc) {
      try {
        headers = { ...headers, ...(JSON.parse(decryptSecret(cfg.headers_enc)) as Record<string, string>) };
      } catch {
        throw new Error(`bad headers_enc for vendor ${this.vendorName}`);
      }
    }
    let body = method === 'POST' && cfg.body_template ? fill(cfg.body_template, vars) : undefined;
    // Same override for POST JSON bodies: replace a hardcoded sender value
    // ("sendername":"NDRTEd" / "sender":"NDRTEd" / "from":"…") with the
    // resolved template SID so the vendor sees the picked SID.
    if (multiSid && body) {
      body = body.replace(
        /("(?:sendername|senderid|sender_id|sender|from|source|header)"\s*:\s*")[^"]*(")/gi,
        `$1${applied.from}$2`,
      );
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    } catch (e) {
      throw new Error(`http vendor unreachable: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      throw new Error(`http vendor status=${res.status} body=${text.slice(0, 200)}`);
    }
    // Audit trail: what the vendor actually saw (resolved SID + final text)
    // plus their raw response excerpt. When the handset receives nothing but
    // the vendor later reports DELIVRD, this proves whether WE sent the wrong
    // SID/template upstream or THE VENDOR faked the DLR.
    void getPool().query(
      `INSERT INTO message_events (message_id, vendor_id, event, detail) VALUES ($1,$2,'sent-audit',$3)`,
      [opts.internal_id, this.vendorId,
       `upstream from=${applied.from} text=${applied.text.slice(0, 160)} resp=${text.slice(0, 160)}`],
    ).catch(() => undefined);
    // Vendor-level error detection: some HTTP vendors return HTTP 200 with an
    // error payload instead of a non-2xx status. Treat those as failures so
    // failover/retry engages instead of marking a fake send.
    // Covers Fortius-style {"status":"false","code":"008",...} as well as
    // SamparkHub-style {responseCode,status,msg} payloads.
    try {
      const probe: unknown = JSON.parse(text);
      const items = Array.isArray(probe) ? probe : [probe];
      for (const it of items) {
        const rec = it as Record<string, unknown>;
        const statusRaw = String(rec.status ?? '');
        // Explicit failure flag: status "false"/"fail"/"failed"/"error"
        if (/^(false|fail|failed|error|0)$/i.test(statusRaw.trim())) {
          throw new Error(`http vendor rejected: ${text.slice(0, 200)}`);
        }
        const sig = `${String(rec.responseCode ?? '')} ${statusRaw} ${String(rec.msg ?? '')} ${String(rec.description ?? '')}`;
        if (/invalid|reject|fail|error|not approved|insufficient|deactivat/i.test(sig)) {
          throw new Error(`http vendor rejected: ${text.slice(0, 200)}`);
        }
      }
    } catch (e) {
      if ((e as Error).message.startsWith('http vendor rejected:')) throw e;
      // non-JSON body (e.g. plain-text msgid) — not an error payload, continue
    }
    // Extract their message id for DLR correlation (webhook/poll matching).
    if (cfg.msgid_json_path) {
      try {
        const id = pickPath(JSON.parse(text), cfg.msgid_json_path);
        if (id !== undefined && id !== null && String(id)) return String(id);
      } catch {
        // fall through to synthetic id
      }
    }
    return `http-${opts.internal_id.slice(0, 8)}`;
  }

  /** Stats mirror — same counters the SMPP path bumps. */
  async markSent(): Promise<void> {
    await getPool().query(
      'UPDATE vendor_connections SET messages_sent = messages_sent + 1 WHERE vendor_id=$1',
      [this.vendorId],
    );
  }
}

/** sha256 hash for inbound webhook tokens (same one-way pattern as API keys). */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
