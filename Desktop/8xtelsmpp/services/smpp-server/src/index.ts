import smpp from 'smpp';
import { getPool, getQueue, getRedis, QUEUES, type DlrEvent } from '@8xtel/core';
import { handleSession, type SmppSession } from './session.js';

// ── 8xtelSMPP SMPP server — downstream client binds (§5, Phase 2) ───────────
// Listens on SMPP_PORT (default 2775). submit_sm → persisted → sms:submit queue.
// Client DLRs are delivered back over bound sessions + sms:client-dlr queue.

const PORT = Number(process.env.SMPP_PORT ?? 2775);
const HOST = process.env.SMPP_HOST ?? '0.0.0.0';
// Alt listener for clients whose network blocks outbound 2775 (very common
// on corporate firewalls). Same handler, shared session registry — binds on
// either port behave identically. Unset = single listener.
const ALT_PORT = process.env.SMPP_ALT_PORT ? Number(process.env.SMPP_ALT_PORT) : null;

// Live session registry for DLR delivery back to clients.
// One entry PER bound session (a client usually holds several binds): DLRs
// round-robin across them so a single socket never becomes the fan-out
// bottleneck at high TPS. Transmitter-only binds are tracked but skipped
// for DLRs — SMPP-wise they can't receive deliver_sm.
interface BoundSession {
  session: SmppSession;
  bindType: string;
}
const sessions = new Map<string, BoundSession[]>(); // client_id → sessions
const dlrCursor = new Map<string, number>(); // client_id → round-robin cursor

export function getClientSession(clientId: string): SmppSession | undefined {
  return pickDlrSession(clientId)?.session;
}

/** Round-robin pick of a DLR-capable (receiver/transceiver) session. */
function pickDlrSession(clientId: string): BoundSession | undefined {
  const list = (sessions.get(clientId) ?? []).filter((b) => b.bindType !== 'transmitter');
  if (!list.length) return undefined;
  const cursor = (dlrCursor.get(clientId) ?? 0) % list.length;
  dlrCursor.set(clientId, cursor + 1);
  return list[cursor];
}

function onConnection(session: SmppSession): void {
  // smpp lib exposes remote address on the socket
  const remoteIp =
    ((session as unknown as { socket?: { remoteAddress?: string } }).socket?.remoteAddress ?? 'unknown')
      .replace(/^::ffff:/, '');
  handleSession(session, remoteIp, {
    onBind: (clientId, s, bindType) => {
      const list = sessions.get(clientId) ?? [];
      list.push({ session: s, bindType });
      sessions.set(clientId, list);
    },
    onClose: (clientId, s) => {
      const list = sessions.get(clientId) ?? [];
      const rest = list.filter((b) => b.session !== s);
      if (rest.length) sessions.set(clientId, rest);
      else {
        sessions.delete(clientId);
        dlrCursor.delete(clientId);
      }
    },
  });
}

const server = smpp.createServer(onConnection);

server.listen(PORT, HOST, () => {
  console.log(`[8xtelSMPP smpp-server] listening on ${HOST}:${PORT}`);
  // All TCP binds died with the old process — wipe the live mirror so the
  // panel never shows a ghost "connected" after a restart/redeploy.
  getPool().query('DELETE FROM client_binds')
    .then((r) => console.log(`[8xtelSMPP smpp-server] cleared ${r.rowCount} stale client_binds`))
    .catch((e: Error) => console.error('[smpp] client_binds boot wipe failed', e.message));
});

// Optional second listener (e.g. 443) for firewall-restricted clients
if (ALT_PORT && ALT_PORT !== PORT) {
  const alt = smpp.createServer(onConnection);
  alt.listen(ALT_PORT, HOST, () => {
    console.log(`[8xtelSMPP smpp-server] alt listener on ${HOST}:${ALT_PORT}`);
  });
}

// ── Client DLR fan-out (§17): deliver_sm over the bound sessions ────────────
// Round-robins across the client's receiver/transceiver binds, and serializes
// writes per client: one slow-reading client socket can't interleave-garble
// receipts or stall another client's DLRs behind its backpressure.
const dlrChains = new Map<string, Promise<void>>();

function sendClientDlr(
  dlr: DlrEvent & { client_id: string; source: string; destination: string },
): Promise<void> {
  const prev = dlrChains.get(dlr.client_id) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      const bound = pickDlrSession(dlr.client_id);
      if (!bound) {
        console.warn(`[smpp] no bound session for client ${dlr.client_id}, DLR ${dlr.internal_id} deferred`);
        throw new Error('client not bound'); // retry with backoff (§37)
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('client deliver_sm timeout')), 10_000);
        if (typeof timer.unref === 'function') timer.unref();
        try {
          bound.session.deliver_sm(
            {
              source_addr: dlr.destination,
              destination_addr: dlr.source,
              short_message:
                `id:${dlr.internal_id} sub:001 dlvrd:001 submit date:${dateFmt()} done date:${dateFmt()} stat:${statusToken(dlr.status)} err:${dlr.error_code ?? '000'} text:`,
              esm_class: 4, // delivery receipt
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (resp: any) => {
              clearTimeout(timer);
              if (resp && typeof resp.command_status === 'number' && resp.command_status !== 0) {
                reject(new Error(`client deliver_sm_resp status=${resp.command_status}`));
              } else {
                resolve();
              }
            },
          );
        } catch (e) {
          clearTimeout(timer);
          reject(e);
        }
      });
    });
  dlrChains.set(dlr.client_id, next.catch(() => undefined));
  // Bound the map: drop settled chains for clients with no live sessions.
  if (dlrChains.size > 10_000 && !sessions.has(dlr.client_id)) dlrChains.delete(dlr.client_id);
  return next;
}

async function startClientDlrConsumer(): Promise<void> {
  const { Worker } = await import('bullmq');
  const redis = getRedis();
  new Worker(
    QUEUES.clientDlr,
    async (job) => {
      // Migration shim: jobs enqueued before the queue split share this
      // queue. Forward HTTP callbacks to their new queue instead of
      // mishandling them as SMPP receipts.
      if (job.name === 'http-callback') {
        await getQueue(QUEUES.clientDlrHttp).add('http-callback', job.data);
        return;
      }
      // This queue carries SMPP receipts only (dlr-worker owns the HTTP one).
      await sendClientDlr(job.data as DlrEvent & { client_id: string; source: string; destination: string });
    },
    { connection: redis, concurrency: 50, lockDuration: 60_000 },
  );
  console.log('[8xtelSMPP smpp-server] client-DLR consumer started');
}

function dateFmt(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

function statusToken(status: string): string {
  switch (status) {
    case 'delivered': return 'DELIVRD';
    case 'expired': return 'EXPIRED';
    case 'undelivered': return 'UNDELIV';
    case 'rejected': return 'REJECTD';
    case 'failed': return 'FAILED';
    default: return 'UNKNOWN';
  }
}

startClientDlrConsumer().catch((e) => {
  console.error('[smpp] dlr consumer failed', e);
  process.exit(1);
});
