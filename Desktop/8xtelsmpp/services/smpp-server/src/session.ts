import { randomUUID } from 'node:crypto';
import {
  queryOne, getPool, getQueue, getRcsQueue, QUEUES, RCS_QUEUES, tryAcquireTps, incrStat, submitQueueFor, getAnyQueue, trackBulkClient,
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
  /** client_binds row for this session (null until a bind is accepted) */
  bindRowId: string | null;
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
  hooks: {
    onBind?: (clientId: string, s: SmppSession, bindType: string) => void;
    onClose?: (clientId: string, s: SmppSession) => void;
  } = {},
): void {
  const state: SessionState = { principal: null, bindType: null, remoteIp, bindRowId: null };

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
      // ── Live bind mirror: one row per accepted session, read by the API ──
      // Best-effort: a mirror failure must never fail the bind itself.
      try {
        const { rows } = await getPool().query(
          `INSERT INTO client_binds (client_id, system_id, bind_type, remote_ip)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [state.principal.client_id, state.principal.system_id, type, remoteIp],
        );
        state.bindRowId = (rows[0] as { id: string }).id;
      } catch (e) {
        console.error('[smpp] client_binds insert failed', (e as Error).message);
      }
      session.send(pdu.response({ command_status: ST.ROK, system_id: '8xtelSMPP' }));
      session.resume();
      hooks.onBind?.(state.principal.client_id, session, type);
      console.log(`[smpp] bind ${type} ${state.principal.system_id} from ${remoteIp}`);
    };
  }

  session.on('submit_sm', async (pdu: Pdu) => {
    if (!state.principal || state.bindType === 'receiver') {
      respond(pdu, ST.RINVBNDSTS);
      return;
    }
    const principal = state.principal;

    // TPS guard — throttle instead of drop (§18).
    // Non-filling acquire: a denied submit leaves no window entry, so a
    // burst over the limit can't saturate the window and throttle the client
    // even after it drops back under its limit.
    const tpsOk = await tryAcquireTps(`client:${principal.client_id}`, principal.tps_limit);
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

    // ── RCS over SMPP (text-only) ──────────────────────────────────────
    // If client has rcs_enabled and destination appears RCS-routable
    // (has an active RCS route allocation + approved RCS sender), treat
    // this submit_sm as RCS {type:text}. Rich cards/carousel stay HTTP/portal.
    // Falls back to SMS silently when not RCS-routable.
    if (principal.rcs_enabled) {
      try {
        const rcsId = await trySubmitRcsOverSmpp(principal.client_id, source, destination, pdu);
        if (rcsId) {
          await incrStat('submitted');
          if (state.bindRowId) {
            void getPool().query(
              'UPDATE client_binds SET submit_count = submit_count + 1, last_activity_at=now() WHERE id=$1',
              [state.bindRowId],
            ).catch((e: Error) => console.error('[smpp] client_binds touch failed', e.message));
          }
          respond(pdu, ST.ROK, { message_id: rcsId });
          return;
        }
      } catch (e) {
        // RCS path failed — fall through to SMS instead of rejecting the submit
        console.warn('[smpp] RCS submit fallback to SMS', (e as Error).message);
      }
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

    const job = {
      internal_id: internalId,
      client_id: principal.client_id,
      client_msg_id: `c-${internalId.slice(0, 8)}`,
      channel: 'sms',
      source,
      destination,
      country_id: null,
      text,
      data_coding: Number(pdu.data_coding ?? 0),
      route_id: null,
      attempts: 0,
      _bulk: false,
    } as MessageJob & { _bulk: boolean };
      await getAnyQueue(submitQueueFor(job)).add('submit', job as never, { jobId: internalId });
    await incrStat('submitted');
    if (state.bindRowId) {
      void getPool().query(
        'UPDATE client_binds SET submit_count = submit_count + 1, last_activity_at=now() WHERE id=$1',
        [state.bindRowId],
      ).catch((e: Error) => console.error('[smpp] client_binds touch failed', e.message));
    }

    respond(pdu, ST.ROK, { message_id: internalId });
  });

  // ── Helpers: RCS over SMPP ──────────────────────────────────────────
  async function trySubmitRcsOverSmpp(clientId: string, source: string, destination: string, pdu: Pdu): Promise<string | null> {
    // Normalize destination for RCS — needs E.164 with leading +
    const rawDest = destination.trim();
    // quick check: must be digits with optional + (shared helper in core normalizes)
    // If it doesn't look like E.164, don't steal from SMS routing.
    if (!/^\+?[1-9][0-9]{6,14}$/.test(rawDest.replace(/[\s().-]/g, ''))) return null;

    // Must have an approved RCS sender for this client+sender
    const senderOk = await queryOne<{ status: string }>(
      `SELECT status FROM rcs_senders WHERE client_id=$1 AND sender=$2 ORDER BY country_id NULLS LAST LIMIT 1`,
      [clientId, source],
    );
    if (!senderOk || senderOk.status !== 'approved') return null;

    // Must have at least one active RCS route allocated to this client
    const routeHit = await queryOne<{ id: string }>(
      `SELECT r.id FROM rcs_routes r
       JOIN rcs_route_clients rc ON rc.route_id=r.id AND rc.client_id=$1
       WHERE r.status='active' LIMIT 1`,
      [clientId],
    );
    if (!routeHit) return null;

    // Resolve country from destination to validate rate exists (reuse rcs_rates lookup)
    const normDest = rawDest.startsWith('+') ? rawDest : `+${rawDest.replace(/^0+/, '')}`;
    const country = await queryOne<{ id: string }>(
      `SELECT id FROM countries WHERE status='active' AND $1 LIKE '+'||calling_code||'%' ORDER BY length(calling_code) DESC LIMIT 1`,
      [normDest],
    );
    if (!country) return null;

    // Rate must exist (otherwise rcs-api createMessage would 422 — mimic here)
    const rate = await queryOne<{ price: string }>(
      `SELECT price::text FROM rcs_rates WHERE client_id=$1 AND country_id=$2 AND effective_from<=now() ORDER BY effective_from DESC LIMIT 1`,
      [clientId, country.id],
    );
    if (!rate) return null;

    // Build RCS text content from SMPP short_message
    const sm = pdu.short_message;
    const text = Buffer.isBuffer(sm) ? sm.toString('utf8') : typeof sm === 'string' ? sm : String(sm?.message ?? '');
    const cleanText = text.slice(0, 4096).trim();
    if (!cleanText) return null;
    if (Buffer.byteLength(JSON.stringify({ type: 'text', text: cleanText })) > 32768) return null;

    const price = String(rate.price);
    const messageId = randomUUID();

    // Same transactional shape as rcs-api createMessage: wallet reserve + rcs_messages + outbox
    const db = await getPool().connect();
    try {
      await db.query('BEGIN');
      const wallet = await db.query('SELECT balance, reserved, credit_limit FROM rcs_wallets WHERE client_id=$1 FOR UPDATE', [clientId]);
      if (!wallet.rowCount) {
        // Auto-create wallet row on first RCS use (USD, zero balance)
        await db.query('INSERT INTO rcs_wallets(client_id, currency) VALUES($1,$2) ON CONFLICT(client_id) DO NOTHING', [clientId, 'USD']);
        await db.query('ROLLBACK');
        return null; // need balance credited first — report as SMS fallback so client not blocked
      }
      const w = wallet.rows[0];
      if (Number(w.balance) - Number(w.reserved) + Number(w.credit_limit) < Number(price)) {
        await db.query('ROLLBACK');
        return null; // insufficient RCS balance — fall back to SMS path (or operator can top up RCS wallet)
      }
      await db.query(
        `INSERT INTO rcs_messages(id, client_id, sender, destination, country_id, content, status, price)
         VALUES($1,$2,$3,$4,$5,$6,'queued',$7)`,
        [messageId, clientId, source, normDest, country.id, JSON.stringify({ type: 'text', text: cleanText }), price],
      );
      const reservation = await db.query(`INSERT INTO rcs_billing_reservations(client_id, message_id, amount) VALUES($1,$2,$3) RETURNING id`, [clientId, messageId, price]);
      const upd = await db.query(`UPDATE rcs_wallets SET reserved=reserved+$1, updated_at=now() WHERE client_id=$2 RETURNING balance, reserved`, [price, clientId]);
      await db.query(
        `INSERT INTO rcs_ledger(client_id, reservation_id, message_id, type, amount, balance_after, reserved_after, event_key)
         VALUES($1,$2,$3,'reserve',$4,$5,$6,$7)`,
        [clientId, reservation.rows[0].id, messageId, price, upd.rows[0].balance, upd.rows[0].reserved, `reserve:${messageId}`],
      );
      await db.query(`INSERT INTO rcs_outbox(message_id, queue_name, dispatch_key) VALUES($1,$2,'initial') ON CONFLICT DO NOTHING`, [messageId, RCS_QUEUES.route]);
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      db.release();
    }
    // Publish to worker outbox → rcs-route queue
    await getRcsQueue(RCS_QUEUES.route).add('route', { message_id: messageId }, { jobId: `${messageId}:outbox:initial` }).catch(() => undefined);
    return messageId;
  }

  session.on('enquire_link', (pdu: Pdu) => {
    session.send(pdu.response({ command_status: ST.ROK }));
    if (state.bindRowId) {
      void getPool().query('UPDATE client_binds SET last_activity_at=now() WHERE id=$1', [
        state.bindRowId,
      ]).catch((e: Error) => console.error('[smpp] client_binds touch failed', e.message));
    }
  });

  session.on('unbind', (pdu: Pdu) => {
    session.send(pdu.response({ command_status: ST.ROK }));
    session.close();
  });

  session.on('close', () => {
    if (state.bindRowId) {
      const id = state.bindRowId;
      state.bindRowId = null;
      void getPool().query('DELETE FROM client_binds WHERE id=$1', [id])
        .catch((e: Error) => console.error('[smpp] client_binds delete failed', e.message));
    }
    if (state.principal) {
      console.log(`[smpp] unbind ${state.principal.system_id}`);
      hooks.onClose?.(state.principal.client_id, session);
    }
  });

  session.on('error', (pdu: Pdu) => {
    console.error('[smpp] session error', (pdu as unknown as { message?: string }).message ?? 'unknown');
  });
}
