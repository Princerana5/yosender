# 8xtelSMPP deployment (Linux + Docker, §39, Phase 8)

## Prerequisites

- Ubuntu 22.04+, Docker + Docker Compose v2, a domain (e.g. `8xtelsmpp.com`)
- Open TCP **2775** (SMPP), **443/80** (panel/API)

## Steps

```bash
git clone <repo> 8xtelsmpp && cd 8xtelsmpp
cp .env.example .env
# edit .env: JWT_SECRET, POSTGRES_PASSWORD, VENDOR_SECRET_KEY, BOOTSTRAP_ADMIN_*
docker compose up --build -d
docker compose exec api npm run migrate
docker compose exec api npm run seed
```

- Panel: `https://panel.8xtelsmpp.com` → frontend
- API: `https://panel.8xtelsmpp.com/api` (reverse-proxy `/api` → api:8080)
- SMPP: `smpp.8xtelsmpp.com:2775` (DNS A record → host)

## Production checklist (§32, §38)

- [ ] Strong `JWT_SECRET`, `VENDOR_SECRET_KEY`, DB password; rotate bootstrap admin password
- [ ] TLS on panel/API (reverse proxy); `use_tls` per vendor where supported
- [ ] PostgreSQL backups (daily `pg_dump` + WAL); Redis AOF on (already in compose)
- [ ] Partition `messages`/`message_events` monthly when volume grows:
  `CREATE TABLE messages_2026_09 PARTITION OF messages FOR VALUES FROM (...) TO (...)`
- [ ] Monitor `/health/*`, queue depth (`sms:*`), TPS, DLR latency, delivery ratio
- [ ] `VITE_API_URL` baked at frontend build time for prod domain
```

## Backups

```bash
docker compose exec postgres pg_dump -U xtel xtelsmpp > backup-$(date +%F).sql
```
