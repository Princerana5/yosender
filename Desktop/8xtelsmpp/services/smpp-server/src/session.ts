import { randomUUID } from 'node:crypto';
import {
  queryOne, getPool, getQueue, QUEUES, checkTps, incrStat,
  COMMAND_STATUS, type MessageJob,
} from '@8xtel/core';
import { authenticateBind, BindPrincipal } from './auth.js';

// Minimal typings over the `smpp` package session object.
export interface SmppSession {
  on(event: 'bind_transceiver' | 'bind_transmitter' | 'bind_receiver' | 'submit_sm' | 'enquire_link' | 'unbind' | 'close' | 'error', fn: (pdu: Pdu) => void): void;
  send(pdu: Pdu): void;
  pause(): void;
  resume(): void;
  close(): void;
}

export interface Pdu {
  command: string;
  command_id?: number;
  sequence_number: number;
  system_id?: string;
  password?: string;
  source_addr?: string;
  destination_addr?: string;
  short_message?: string | Buffer;
  data_coding?: number;
  registered_delivery?: number;
  [k: string]: unknown;
}

interface SessionState {
  principal: BindPrincipal | null;
  bindType: string | null;
  remoteIp: string;
}

/** Handle one downstream TCP session: bind → submit_sm → enqueue → resp. */
export function handleSession(
  session: SmppSession,
  remoteIp: string,
  hooks: { onBind?: (clientId: string, s: SmppSession) => void; onClose?: (clientId: string) => void } = {},
): void {
  const state: SessionState = { principal: null, bindType: null, remoteIp };

  const respond = (pdu: Pdu, status: number, extra: Record<string, unknown> = {}): void => {
    session.send({
      command: `${pdu.command}_resp`,
      sequence_number: pdu.sequence_number,
      command_status: status,
      ...extra,
    } as Pdu);
  };

  session.on('bind_transceiver', onBind('transceiver'));
  session.on('bind_transmitter', onBind('transmitter'));
  session.on('bind_receiver', onBind('receiver'));

  function onBind(type: string) {
    return async (pdu: Pdu): Promise<void> => {
      const result = await authenticateBind(
        String(pdu.system_id ?? ''), String(pdu.password ?? ''), remoteIp, type,
      );
      if (!result.ok) {
        respond(pdu, COMMAND_STATUS.ESME_RINVPASWD);
        session.pause();
        return;
      }
      state.principal = result.principal;
      state.bindType = type;
      await getPool().query(
        `INSERT INTO smpp_logs (kind, client_id, ip, system_id, result, reason)
         VALUES ('bind',$1,$2,$3,'accept',$4)`,
        [state.principal.client_id, remoteIp, state.principal.system_id, `bind_${type}`],
      );
      respond(pdu, COMMAND_STATUS.ESME_ROK, { system_id: process.env.SMPP_PUBLIC_HOST ?? '8xtelSMPP' });
      hooks.onBind?.(state.principal.client_id, session);
      console.log(`[smpp] bind ${type} ${state.principal.system_id} from ${remoteIp}`);
    };
  }

  session.on('submit_sm', async (pdu: Pdu) => {
    if (!state.principal || state.bindType === 'receiver') {
      respond(pdu, COMMAND_STATUS.ESME_RINVBNDSTS);
      return;
    }
    const principal = state.principal;

    // TPS guard — queue instead of drop (§18)
    const tpsOk = await checkTps(`client:${principal.client_id}`, principal.tps_limit);
    if (!tpsOk) {
      respond(pdu, COMMAND_STATUS.ESME_RTHROTTLED);
      return;
    }

    const destination = String(pdu.destination_addr ?? '');
    const source = String(pdu.source_addr ?? '');
    if (!destination) {
      respond(pdu, COMMAND_STATUS.ESME_RINVDSTADR);
      return;
    }

    // Sender-ID permission (§21)
    const senderRule = await queryOne<{ status: string }>(
      `SELECT status FROM sender_ids WHERE client_id=$1 AND sender=$2
       AND (country_id IS NULL OR TRUE) ORDER BY country_id NULLS LAST LIMIT 1`,
      [principal.client_id, source],
    );
    if (senderRule && senderRule.status === 'blocked') {
      respond(pdu, COMMAND_STATUS.ESME_RINVSRCADR);
      return;
    }

    const internalId = randomUUID();
    const text = Buffer.isBuffer(pdu.short_message)
      ? pdu.short_message.toString('utf8')
      : String(pdu.short_message ?? '');

    // Persist immediately (web restarts must not lose messages — §37)
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
      data_coding: pdu.data_coding ?? 0,
      route_id: null,
      attempts: 0,
    };
    await getQueue(QUEUES.submit).add('submit', job, { jobId: internalId });
    await incrStat('submitted');

    respond(pdu, COMMAND_STATUS.ESME_ROK, { message_id: internalId });
  });

  session.on('enquire_link', (pdu: Pdu) => respond(pdu, COMMAND_STATUS.ESME_ROK));

  session.on('unbind', (pdu: Pdu) => {
    respond(pdu, COMMAND_STATUS.ESME_ROK);
    session.close();
  });

  session.on('close', () => {
    if (state.principal) {
      console.log(`[smpp] unbind ${state.principal.system_id}`);
      hooks.onClose?.(state.principal.client_id);
    }
  });

  session.on('error', (pdu: Pdu) => {
    console.error('[smpp] session error', (pdu as { message?: string }).message ?? pdu);
  });
}
