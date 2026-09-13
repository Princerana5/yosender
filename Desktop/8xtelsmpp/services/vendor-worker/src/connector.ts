import crypto from 'node:crypto';
import smpp from 'smpp';
import { query, getPool, getRedis } from '@8xtel/core';

// ── Upstream vendor SMPP connector (§7–§8, §37) ──────────────────────────────
// Persistent bind(s) per vendor, auto-reconnect with backoff, enquire_link,
// live state mirrored to vendor_connections, control via Redis pub/sub.

interface VendorConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  system_id: string;
  password_enc: string;
  bind_type: string;
  tps: number;
  reconnect_interval_sec: number;
}

type AnySession = {
  on(e: string, fn: (...a: never[]) => void): void;
  submit_sm(p: unknown, cb: (pdu: { message_id?: string; command_status: number }) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(pdu: any): void;
  close(): void;
  [k: string]: unknown;
};

function decKey(): Buffer {
  return crypto.createHash('sha256').update(process.env.VENDOR_SECRET_KEY ?? 'dev-vendor-key-please-change-32b!!').digest();
}

export function decryptSecret(enc: string): string {
  const [iv, tag, ct] = enc.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', decKey(), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return decipher.update(Buffer.from(ct, 'hex'), undefined, 'utf8') + decipher.final('utf8');
}

export class VendorConnector {
  private session: AnySession | null = null;
  private reconnects = 0;
  private stopped = false;
  private enquireTimer: NodeJS.Timeout | null = null;
  /** Guard: one dial at a time + never dial while a live session exists.
      Without this, overlapping fail() timers open a socket per retry and
      leak them (ENOBUFS outage under sustained vendor downtime). */
  private dialing = false;

  constructor(private cfg: VendorConfig, private connIndex = 0) {}

  /** Fingerprint of everything that affects the bind — used to skip
      reloads when a sync carries no actual change. */
  fingerprint(): string {
    const c = this.cfg;
    return [c.host, c.port, c.system_id, c.password_enc, c.bind_type, c.tps, c.reconnect_interval_sec].join('|');
  }

  matches(cfg: VendorConfig): boolean {
    const c = this.cfg;
    return c.host === cfg.host && c.port === cfg.port && c.system_id === cfg.system_id
      && c.password_enc === cfg.password_enc && c.bind_type === cfg.bind_type
      && c.tps === cfg.tps && c.reconnect_interval_sec === cfg.reconnect_interval_sec;
  }

  get vendorId(): string {
    return this.cfg.id;
  }

  get index(): number {
    return this.connIndex;
  }

  get connected(): boolean {
    return this.session !== null;
  }

  /** Hot-swap config (host/port/creds/TPS…) then reconnect with the new values.
      Only called for enabled vendors — disabled ones are stopped, not reloaded. */
  async reload(cfg: VendorConfig): Promise<void> {
    await this.stop();
    this.cfg = cfg;
    this.reconnects = 0;
    this.stopped = false;
    await this.connect();
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.dialing = false;
    if (this.enquireTimer) clearInterval(this.enquireTimer);
    this.session?.close();
    this.session = null;
    await this.setStatus('disconnected');
  }

  private async setStatus(
    status: string, extra: Record<string, unknown> = {},
  ): Promise<void> {
    const sets = ['status=$1'];
    const params: unknown[] = [status];
    for (const [k, v] of Object.entries(extra)) {
      params.push(v);
      sets.push(`${k}=$${params.length}`);
    }
    params.push(this.cfg.id, this.connIndex);
    await getPool().query(
      `UPDATE vendor_connections SET ${sets.join(', ')}, updated_at=now()
       WHERE vendor_id=$${params.length - 1} AND conn_index=$${params.length}`,
      params,
    );
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.dialing || this.session) return;
    this.dialing = true;
    await this.setStatus('connecting');
    let settled = false;
    const done = (): void => {
      settled = true;
      this.dialing = false;
    };
    const session = smpp.connect(
      { url: `smpp://${this.cfg.host}:${this.cfg.port}`, auto_enquire_link_period: 30000 },
      () => {
        const bindParams = {
          system_id: this.cfg.system_id,
          password: decryptSecret(this.cfg.password_enc),
        };
        const bindMethod =
          this.cfg.bind_type === 'transmitter' ? 'bind_transmitter'
          : this.cfg.bind_type === 'receiver' ? 'bind_receiver'
          : 'bind_transceiver';
        // Call as session method to preserve `this` (smpp shortcut uses this.send)
        (session as unknown as Record<string, (p: unknown, cb: (resp: { command_status: number }) => void) => void>)[bindMethod].call(
          session,
          bindParams,
          (pdu: { command_status: number }) => {
            done();
            if (pdu.command_status === 0) {
              this.session = session as unknown as AnySession;
              this.reconnects = 0;
              void this.setStatus('connected', { connected_since: new Date().toISOString(), last_error: null });
              console.log(`[vendor] ${this.cfg.name} connected`);
              this.attachDeliverHandler(session as unknown as AnySession);
            } else {
              try { session.close(); } catch { /* already dead */ }
              void this.fail(`bind failed status=${pdu.command_status}`);
            }
          },
        );
      },
    ) as unknown as AnySession;

    session.on('close', () => {
      if (this.session === (session as unknown as AnySession)) this.session = null;
      else {
        // Stale dial that never bound — just release the guard, no fail() storm.
        if (!settled) done();
        return;
      }
      if (!this.stopped) void this.fail('connection closed');
    });
    session.on('error', (e: unknown) => {
      if (this.session === (session as unknown as AnySession)) {
        if (!this.stopped) void this.fail(`error: ${(e as Error).message}`);
      } else if (!settled) {
        done();
        try { session.close(); } catch { /* already dead */ }
        if (!this.stopped) void this.fail(`error: ${(e as Error).message}`);
      }
    });
  }

  private attachDeliverHandler(session: AnySession): void {
    // Vendor → us: deliver_sm carrying DLRs (and MO, logged)
    session.on('deliver_sm', (pdu: unknown) => {
      void (async () => {
        const p = pdu as {
          short_message?: { message?: string } | string;
          data_coding?: number;
          source_addr?: string;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          response: (params?: Record<string, any>) => any;
        };
        // ACK first so the vendor never retries
        try {
          session.send(p.response({ command_status: 0 }));
        } catch (e) {
          console.error('[vendor] deliver_sm ack failed', (e as Error).message);
        }
        const body = typeof p.short_message === 'string' ? p.short_message : String(p.short_message?.message ?? '');
        const { getQueue, QUEUES } = await import('@8xtel/core');
        await getQueue(QUEUES.dlr).add('dlr', {
          vendor_id: this.cfg.id,
          body,
          source: p.source_addr ?? '',
          received_at: new Date().toISOString(),
        });
        await getPool().query(
          'UPDATE vendor_connections SET messages_received = messages_received + 1 WHERE vendor_id=$1 AND conn_index=$2',
          [this.cfg.id, this.connIndex],
        );
      })().catch((e) => console.error('[vendor] deliver_sm handler failed', (e as Error).message));
    });
  }

  private async fail(reason: string): Promise<void> {
    this.session = null;
    this.reconnects += 1;
    await this.setStatus('reconnecting', { last_error: reason, reconnect_count: this.reconnects });
    await getPool().query(
      `INSERT INTO smpp_logs (kind, vendor_id, result, reason) VALUES ('error',$1,'reconnecting',$2)`,
      [this.cfg.id, reason],
    );
    const delay = Math.min(this.cfg.reconnect_interval_sec * 1000 * 2 ** Math.min(this.reconnects, 5), 120_000);
    console.warn(`[vendor] ${this.cfg.name}: ${reason} — retry in ${Math.round(delay / 1000)}s`);
    setTimeout(() => this.connect(), delay);
  }

  /** Submit one SMS over this bind. Resolves with vendor message id. */
  async submit(opts: {
    source: string; destination: string; text: string; data_coding: number;
    source_ton: number; source_npi: number; dest_ton: number; dest_npi: number;
    registered_delivery: number;
  }): Promise<string> {
    const session = this.session;
    if (!session) throw new Error('not connected');
    return new Promise((resolve, reject) => {
      session.submit_sm(
        {
          source_addr: opts.source,
          destination_addr: opts.destination,
          short_message: opts.text,
          data_coding: opts.data_coding,
          source_addr_ton: opts.source_ton,
          source_addr_npi: opts.source_npi,
          dest_addr_ton: opts.dest_ton,
          dest_addr_npi: opts.dest_npi,
          registered_delivery: opts.registered_delivery,
        },
        (pdu) => {
          if (pdu.command_status === 0) resolve(pdu.message_id ?? '');
          else reject(new Error(`submit failed status=${pdu.command_status}`));
        },
      );
    });
  }
}

/** Load all enabled vendors and build connectors (connection_count each). */
export async function loadConnectors(): Promise<VendorConnector[]> {
  const rows = await query<VendorConfig & { connection_count: number }>(
    'SELECT * FROM vendors WHERE status=$1', ['enabled'],
  );
  const out: VendorConnector[] = [];
  for (const v of rows) {
    for (let i = 0; i < (v.connection_count || 1); i++) out.push(new VendorConnector(v, i));
  }
  return out;
}

export type ConnectorRegistry = Map<string, VendorConnector[]>;

function register(reg: ConnectorRegistry, c: VendorConnector): void {
  const list = reg.get(c.vendorId) ?? [];
  list.push(c);
  reg.set(c.vendorId, list);
}

/** Reconcile live connectors with the vendors table — no restart needed.
    - new enabled vendor → build + start its binds
    - edited vendor (host/port/creds/bind_type/…) → hot-reload + reconnect
    - disabled/deleted vendor → stop + drop its binds
    - connection_count change → add or remove binds to match */
export async function syncConnectors(reg: ConnectorRegistry): Promise<void> {
  const rows = await query<VendorConfig & { connection_count: number; status: string }>(
    'SELECT * FROM vendors',
  );
  const seen = new Set<string>();
  for (const v of rows) {
    seen.add(v.id);
    const want = v.status === 'enabled' ? Math.min(8, Math.max(1, v.connection_count || 1)) : 0;
    let list = reg.get(v.id) ?? [];
    // shrink: stop + drop extras
    while (list.length > want) {
      const extra = list.pop();
      if (extra) await extra.stop();
    }
    if (!list.length && want === 0) {
      reg.delete(v.id);
      continue;
    }
    // grow: add missing binds
    for (let i = list.length; i < want; i++) {
      const c = new VendorConnector(v, i);
      list.push(c);
      await c.start();
    }
    if (list.length) reg.set(v.id, list);
    // reload only binds whose config actually changed — untouched binds stay up
    let reloaded = 0;
    for (const c of list) {
      if (!c.matches(v)) {
        await c.reload(v);
        reloaded++;
      }
    }
    console.log(`[vendor] synced ${v.name}: ${list.length} bind(s)${reloaded ? `, ${reloaded} reloaded` : ''}`);
  }
  // deleted vendors: stop + drop everything we still hold
  for (const [id, list] of [...reg.entries()]) {
    if (!seen.has(id)) {
      for (const c of list) await c.stop();
      reg.delete(id);
      console.log(`[vendor] removed deleted vendor ${id.slice(0, 8)}`);
    }
  }
}

/** Listen for connect/disconnect/reconnect commands from the API (§9),
    plus vendor sync signals (created/updated/deleted/disabled). */
export async function listenControl(reg: ConnectorRegistry): Promise<void> {
  const sub = getRedis().duplicate();
  await sub.subscribe('smpp:control');
  sub.on('message', (_ch, raw) => {
    try {
      const msg = JSON.parse(raw) as { connection_id?: string; action: string; vendor_id?: string };
      void (async () => {
        // Vendor-level sync: re-read the vendors table, reconcile binds
        if (msg.action === 'sync' || msg.action === 'vendor-sync') {
          await syncConnectors(reg);
          return;
        }
        if (!msg.connection_id) return;
        const row = await query<{ vendor_id: string; conn_index: number }>(
          'SELECT vendor_id, conn_index FROM vendor_connections WHERE id=$1', [msg.connection_id],
        ).then((r) => r[0]);
        if (!row) return;
        const list = reg.get(row.vendor_id) ?? [];
        const conn = list.find((c) => c.index === row.conn_index) ?? list[0];
        if (!conn) return;
        if (msg.action === 'disconnect') await conn.stop();
        if (msg.action === 'connect' || msg.action === 'reconnect' || msg.action === 'restart') {
          await conn.stop();
          await conn.start();
        }
      })();
    } catch (e) {
      console.error('[vendor] bad control message', (e as Error).message);
    }
  });
}
