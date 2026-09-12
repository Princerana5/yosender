import { randomUUID } from 'node:crypto';
import {
  queryOne, getPool, getQueue, QUEUES, checkTps, incrStat,
  type MessageJob,
} from '@8xtel/core';
import { authenticateBind, BindPrincipal } from './auth.js';

// Typings over the `smpp` package: responses are built via pdu.response().
// See node_modules/smpp/README.md — session.send(pdu.response({...})).
export interface SmppSession {
  on(event: string, fn: (pdu: Pdu) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(pdu: any): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deliver_sm(params: Record<string, any>, cb?: (pdu: any) => void): void;
  pause(): void;
  resume(): void;
  close(): void;
}

export interface Pdu {
  command: string;
  sequence_number: number;
  system_id?: string;
  password?: string;
  source_addr?: string;
  destination_addr?: string;
  short_message?: { message?: string } | string | Buffer;
  data_coding?: number;
  registered_delivery?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response(params?: Record<string, any>): any;
  [k: string]: unknown;
}

interface SessionState {
  principal: BindPrincipal | null;
  bindType: string | null;
  remoteIp: string;
}

/** ESME status codes (SMPP v3.4 §5.1.3) */
const ST = {
  ROK: 0x00000000,
  RINVBNDSTS: 0x00000004,
  RINVSRCADR: 0x0000000a,
  RINVDSTADR: 0x0000000b,
  RMSGQFUL: 0x00000014,
  RTHROTTLED: 0x00000058,
  RINVPASWD: 0x0000000e,
} as const;

/** Handle one downstream TCP session: bind → submit_sm → enqueue → resp. */
export function handleSession(
  session: SmppSession,
  remoteIp: string,
  hooks: { onBind?: (clientId: string, s: SmppSession) => void; onClose?: (clientId: string) => void } = {},
): void {
  const state: SessionState = { principal: null, bindType: null, remoteIp };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const respond = (pdu: Pdu, command_status: number, extra: Record<string, any> = {}): void => {
    session.send(pdu.response({ command_status, ...extra }));
  };

  session.on('bind_transceiver', onBind('transceiver'));
  session.on('bind_transmitter', onBind('transmitter'));
  session.on('bind_receiver', onBind('receiver'));

  function onBind(type: string) {
    return async (pdu: Pdu): Promise<void> => {
      session.pause(); // hold PDUs until auth completes (per smpp README)
      const result = await authenticateBind(
        String(pdu.system_id ?? ''), String(pdu.password ?? ''), remoteIp, type,
      );
      if (!result.ok) {
        session.send(pdu.response({ command_status: ST.RINVPASWD }));
        session.close();
        return;
      }
      state.principal = result.principal;
      state.bindType = type;
      await getPool().query(
        `INSERT INTO smpp_logs (kind, client_id, ip, system_id, result, reason)
         VALUES ('bind',$1,$2,$3,'accept',$4)`,
        [state.principal.client_id, remoteIp, state.principal.system_id, `bind_${type}`],
      );
      session.send(pdu.response({ command_status: ST.ROK, system_id: '8xtelSMPP' }));
      session.resume();
      hooks.onBind?.(state.principal.client_id, session);
      console.log(`[smpp] bind ${type} ${state.principal.system_id} from ${remoteIp}`);
    };
  }

  session.on('submit_sm', async (pdu: Pdu) => {
    if (!state.principal || state.bindType === 'receiver') {
      respond(pdu, ST.RINVBNDSTS);
      return;
    }
    const principal = state.principal;

    // TPS guard — throttle instead of drop (§18)
    const tpsOk = await checkTps(`client:${principal.client_id}`, principal.tps_limit);
    if (!tpsOk) {
      respond(pdu, ST.RTHROTTLED);
      return;
    }

    const destination = String(pdu.destination_addr ?? '');
    const source = String(pdu.source_addr ?? '');
    if (!destination) {
      respond(pdu, ST.RINVDSTADR);
      return;
    }

    // Sender-ID permission (§21)
    const senderRule = await queryOne<{ status: string }>(
      `SELECT status FROM sender_ids WHERE client_id=$1 AND sender=$2
       ORDER BY country_id NULLS LAST LIMIT 1`,
      [principal.client_id, source],
    );
    if (senderRule && senderRule.status === 'blocked') {
      respond(pdu, ST.RINVSRCADR);
      return;
    }

    const internalId = randomUUID();
    const sm = pdu.short_message;
    const text = Buffer.isBuffer(sm)
      ? sm.toString('utf8')
      : typeof sm === 'string'
        ? sm
        : String(sm?.message ?? '');

    // Persist immediately (restarts must not lose messages — §37)
    await getPool().query(
      `INSERT INTO messages (id, client_id, channel, client_msg_id, source, destination, text, data_coding, status)
       VALUES ($1,$2,'sms',$3,$4,$5,$6,$7,'submitted')`,
      [internalId, principal.client_id, `c-${internalId.slice(0, 8)}`, source, destination, text.slice(0, 2000), pdu.data_coding ?? 0],
    );

    const job: MessageJob = {
      internal_id: internalId,
      client_id: principal.client_id,
      client_msg_id: `c-${internalId.slice(0, 8)}`,
      channel: 'sms',
      source,
      destination,
      country_id: null, // resolved by routing-worker
      text,
      data_coding: Number(pdu.data_coding ?? 0),
      route_id: null,
      attempts: 0,
    };
    await getQueue(QUEUES.submit).add('submit', job, { jobId: internalId });
    await incrStat('submitted');

    respond(pdu, ST.ROK, { message_id: internalId });
  });

  session.on('enquire_link', (pdu: Pdu) => {
    session.send(pdu.response({ command_status: ST.ROK }));
  });

  session.on('unbind', (pdu: Pdu) => {
    session.send(pdu.response({ command_status: ST.ROK }));
    session.close();
  });

  session.on('close', () => {
    if (state.principal) {
      console.log(`[smpp] unbind ${state.principal.system_id}`);
      hooks.onClose?.(state.principal.client_id);
    }
  });

  session.on('error', (pdu: Pdu) => {
    console.error('[smpp] session error', (pdu as unknown as { message?: string }).message ?? 'unknown');
  });
}
