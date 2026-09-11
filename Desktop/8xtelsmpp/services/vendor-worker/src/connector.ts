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

  constructor(private cfg: VendorConfig, private connIndex = 0) {}

  get vendorId(): string {
    return this.cfg.id;
  }

  get connected(): boolean {
    return this.session !== null;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
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
    if (this.stopped) return;
    await this.setStatus('connecting');
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
        (session as AnySession)[bindMethod](bindParams, (pdu: { command_status: number }) => {
          if (pdu.command_status === 0) {
            this.session = session as unknown as AnySession;
            this.reconnects = 0;
            void this.setStatus('connected', { connected_since: new Date().toISOString(), last_error: null });
            console.log(`[vendor] ${this.cfg.name} connected`);
            this.attachDeliverHandler(session as unknown as AnySession);
          } else {
            void this.fail(`bind failed status=${pdu.command_status}`);
          }
        });
      },
    ) as unknown as AnySession;

    session.on('close', () => {
      this.session = null;
      if (!this.stopped) void this.fail('connection closed');
    });
    session.on('error', (e: unknown) => {
      if (!this.stopped) void this.fail(`error: ${(e as Error).message}`);
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
          respond: (s: number) => void;
        };
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
        p.respond(0);
      })();
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

/** Listen for connect/disconnect/reconnect commands from the API (§9). */
export async function listenControl(connectors: VendorConnector[]): Promise<void> {
  const sub = getRedis().duplicate();
  await sub.subscribe('smpp:control');
  sub.on('message', (_ch, raw) => {
    try {
      const { connection_id, action } = JSON.parse(raw) as { connection_id: string; action: string };
      void (async () => {
        const row = await query<{ vendor_id: string; conn_index: number }>(
          'SELECT vendor_id, conn_index FROM vendor_connections WHERE id=$1', [connection_id],
        ).then((r) => r[0]);
        if (!row) return;
        const conn = connectors.find(
          (c) => c.vendorId === row.vendor_id,
        );
        if (!conn) return;
        if (action === 'disconnect') await conn.stop();
        if (action === 'connect' || action === 'reconnect' || action === 'restart') {
          await conn.stop();
          await conn.start();
        }
      })();
    } catch (e) {
      console.error('[vendor] bad control message', (e as Error).message);
    }
  });
}
