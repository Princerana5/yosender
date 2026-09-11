# 8xtelSMPP — Enterprise SMPP & Multi-Channel Messaging Gateway

Centralized gateway between **upstream vendors/SMSCs** and **downstream clients**.
Admin manages SMPP connections, clients, vendors, routes, DLRs, billing, traffic,
IP whitelisting, failover, reporting + multi-channel (SMS / WhatsApp / RCS) connectors.

```
Vendor A ─┐   SMPP    ┌──────────────┐   SMPP    ┌─ Client A
Vendor B ─┼──────────▶│  8xtelSMPP   │◀─────────┤─ Client B
Vendor C ─┘           │ gateway core │          └─ Reseller
                      └──────────────┘
```

## Services (separate processes — traffic never blocks the panel)

| Service | Dir | Role |
|---|---|---|
| api | `services/api` | REST API, auth/RBAC, admin backend, Swagger |
| smpp-server | `services/smpp-server` | SMPP server — downstream client binds (2775) |
| vendor-worker | `services/vendor-worker` | Upstream SMPP vendor connectors + reconnect |
| routing-worker | `services/routing-worker` | Route engine: priority / failover / round-robin / least-cost / % |
| dlr-worker | `services/dlr-worker` | DLR receiver, mapping, client delivery |
| billing-worker | `services/billing-worker` | Wallet debit, vendor cost, profit ledger |
| frontend | `frontend` | React admin dashboard |
| postgres / redis | docker | Source of truth / queues + rate limits + stats |

## Quick start

```bash
cp .env.example .env
docker compose up --build -d
npm run migrate   # DB migrations
npm run seed      # bootstrap admin + demo data
```

- Admin UI: http://localhost:5173
- API + Swagger: http://localhost:8080/api-docs
- SMPP (clients): `smpp.8xtelsmpp.com:2775`

Default admin: `admin@8xtelsmpp.com` / `Admin@12345` (change immediately).

## Message flow (§15)

`Client submit_sm → auth → IP check → account → balance → destination →
country → filters → route → vendor → vendor resp → store → DLR → billing → client DLR`

Every message keeps `client_msg_id ↔ internal_msg_id ↔ vendor_msg_id ↔ dlr_id`.

## Docs

- `docs/architecture.md` — module map + queues
- `docs/api.md` — REST reference
- `docs/deployment.md` — Linux production deploy
- `docs/smpp.md` — bind/auth rules, TON/NPI, DLR formats
