// ── Shared SMPP constants (SMPP v3.4) ──────────────────────────────────────
// Command ids, statuses and TON/NPI values used by smpp-server + vendor-worker.

export const COMMAND_ID = {
  bind_transmitter: 0x00000002,
  bind_transmitter_resp: 0x80000002,
  bind_receiver: 0x00000001,
  bind_receiver_resp: 0x80000001,
  bind_transceiver: 0x00000009,
  bind_transceiver_resp: 0x80000009,
  submit_sm: 0x00000004,
  submit_sm_resp: 0x80000004,
  deliver_sm: 0x00000005,
  deliver_sm_resp: 0x80000005,
  enquire_link: 0x00000015,
  enquire_link_resp: 0x80000015,
  unbind: 0x00000006,
  unbind_resp: 0x80000006,
} as const;

export const COMMAND_STATUS = {
  ESME_ROK: 0x00000000,
  ESME_RINVBNDSTS: 0x00000004,
  ESME_RSYSERR: 0x00000008,
  ESME_RINVSRCADR: 0x0000000a,
  ESME_RINVDSTADR: 0x0000000b,
  ESME_RMSGQFUL: 0x00000014,
  ESME_RTHROTTLED: 0x00000058,
  ESME_RINVSYSID: 0x0000000f,
  ESME_RINVPASWD: 0x0000000e,
} as const;

/** registered_delivery flag requesting DLR */
export const REGISTERED_DELIVERY_REQUEST = 0x01;

/** Map vendor DLR stat token → internal status (§16) */
export function mapDlrStatus(stat: string): string {
  const s = stat.trim().toUpperCase();
  if (s.startsWith('DELIVRD')) return 'delivered';
  if (s.startsWith('EXPIRED')) return 'expired';
  if (s.startsWith('UNDELIV')) return 'undelivered';
  if (s.startsWith('REJECTD')) return 'rejected';
  if (s.startsWith('FAILED')) return 'failed';
  if (s.startsWith('ACCEPTD') || s.startsWith('ENROUTE')) return 'submitted';
  return 'unknown';
}

/** Parse `id:.. sub:.. stat:DELIVRD ...` DLR text body */
export function parseDlrBody(body: string): { vendor_msg_id: string | null; stat: string } {
  const id = body.match(/\bid:([^\s]+)/i)?.[1] ?? null;
  const stat = body.match(/\bstat:([A-Za-z]+)/)?.[1] ?? 'UNKNOWN';
  return { vendor_msg_id: id, stat };
}
