import smpp from 'smpp';
import { getPool, getRedis, QUEUES, type DlrEvent } from '@8xtel/core';
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

// Live session registry for DLR delivery back to clients
const sessions = new Map<string, SmppSession>(); // client_id → session

export function getClientSession(clientId: string): SmppSession | undefined {
  return sessions.get(clientId);
}

function onConnection(session: SmppSession): void {
  // smpp lib exposes remote address on the socket
  const remoteIp =
    ((session as unknown as { socket?: { remoteAddress?: string } }).socket?.remoteAddress ?? 'unknown')
      .replace(/^::ffff:/, '');
  handleSession(session, remoteIp, {
    onBind: (clientId, s) => sessions.set(clientId, s),
    onClose: (clientId) => {
      if (sessions.get(clientId) === session) sessions.delete(clientId);
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

// ── Client DLR fan-out (§17): deliver_sm over the bound session ─────────────
async function startClientDlrConsumer(): Promise<void> {
  const { Worker } = await import('bullmq');
  const redis = getRedis();
  new Worker(
    QUEUES.clientDlr,
    async (job) => {
      const dlr = job.data as DlrEvent & { client_id: string; source: string; destination: string };
      const session = sessions.get(dlr.client_id);
      if (!session) {
        console.warn(`[smpp] no bound session for client ${dlr.client_id}, DLR ${dlr.internal_id} deferred`);
        throw new Error('client not bound'); // retry with backoff (§37)
      }
      session.deliver_sm({
        source_addr: dlr.destination,
        destination_addr: dlr.source,
        short_message:
          `id:${dlr.internal_id} sub:001 dlvrd:001 submit date:${dateFmt()} done date:${dateFmt()} stat:${statusToken(dlr.status)} err:${dlr.error_code ?? '000'} text:`,
        esm_class: 4, // delivery receipt
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    },
    { connection: redis, concurrency: 20 },
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
