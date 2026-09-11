# SMPP notes (§5–§9)

## Client binds (downstream → 8xtelSMPP :2775)

- Supported: `bind_transceiver`, `bind_transmitter`, `bind_receiver`
- Accepted only if: correct system_id + password, source IP whitelisted
  (if any IPs configured), account `active`, balance + credit > 0
- `submit_sm` requires bound session (receiver-only binds rejected)
- Throttled binds get `ESME_RTHROTTLED`; messages are queued, not dropped
- `enquire_link` answered; `deliver_sm` with `esm_class=4` carries DLRs:
  `id:<internal> sub:001 dlvrd:001 submit date:.. done date:.. stat:DELIVRD err:000 text:`

## Vendor binds (8xtelSMPP → upstream)

- Configured per vendor: host, port, system_id, password (AES-256-GCM at rest),
  bind type, TON/NPI, TLS flag, TPS, connection count
- States: `connected | disconnected | connecting | reconnecting | error`
  mirrored in `vendor_connections`; auto-reconnect with exponential backoff
- Control from panel: connect / disconnect / reconnect / restart
  (published on Redis `smpp:control`)
- Incoming `deliver_sm` → parsed (`id:`/`stat:`) → `sms:dlr` queue

## DLR stat mapping

`DELIVRD→delivered, EXPIRED→expired, UNDELIV→undelivered, REJECTD→rejected,
FAILED→failed, ACCEPTD/ENROUTE→submitted, else unknown`
