# 8xtelSMPP architecture (§1–§2, §36–§37)

```
DOWNSTREAM (clients)              8xtelSMPP CORE                    UPSTREAM (vendors)
                         ┌─────────────────────────┐
Client A ── SMPP ──▶     │ smpp-server (:2775)     │     ┌── Vendor A (SMPP bind)
Client B ── SMPP ──▶     │  bind auth + IP check   │     ├── Vendor B (SMPP bind)
Reseller ── SMPP ──▶     │  persist → sms:submit   │     └── Vendor C (SMPP bind)
                         └────────────┬────────────┘              ▲
                                      ▼                           │ submit_sm / deliver_sm(DLR)
                         ┌─────────────────────────┐     ┌────────┴──────────┐
                         │ routing-worker          │     │ vendor-worker     │
                         │ country→filter→route→   │────▶│ connectors, TPS,  │
                         │ chain + price snapshot  │     │ failover chain    │
                         └────────────┬────────────┘     └────────┬──────────┘
                                      │ sms:vendor-send           │ sms:dlr
                                      ▼                           ▼
                         ┌─────────────────────────┐     ┌───────────────────┐
                         │ billing-worker          │     │ dlr-worker        │
                         │ debit/refund, ledger,   │     │ map vendor→client │
                         │ revenue/cost/profit     │     │ immutable raw DLR │
                         └─────────────────────────┘     └─────────┬─────────┘
                                                                   │ sms:client-dlr
                                                                   ▼
                                                         smpp-server → deliver_sm
                                                         or HTTP callback
```

## Queues (Redis/BullMQ)

| Queue | Producer → Consumer | Notes |
|---|---|---|
| `sms:submit` | smpp-server → routing-worker | 5 attempts, exponential backoff |
| `sms:vendor-send` | routing-worker → vendor-worker | carries `vendor_chain[]` + index |
| `sms:dlr` | vendor-worker → dlr-worker | parsed, mapped, stored |
| `sms:billing` | vendor-worker → billing-worker | `charge` / `refund`, idempotent |
| `sms:client-dlr` | dlr-worker → smpp-server / HTTP | retried with backoff |

## Key rules

- PostgreSQL = source of truth; Redis = queues, TPS windows, stats, mappings.
- Messages persisted **before** queueing — dashboard restarts lose nothing (§37).
- Raw vendor DLR immutable; traffic policies only derive client-visible status (§19).
- Failover walks `vendor_chain`; exhausted chain → `failed` + refund.
- SMPP layer is a separate process from the API (§41).
