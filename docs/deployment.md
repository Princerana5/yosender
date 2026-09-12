# 8xtelSMPP deployment (Linux + Docker)

Pilot-ready runbook: VPS → TLS → first vendor → first client.

## 1. Server

- Ubuntu 22.04+, 4 vCPU / 8 GB RAM minimum (bulk + workers are hungry).
- Install Docker + Compose v2:
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER && newgrp docker
  ```
- Open TCP **80/443** (panel/API) and **2775** (SMPP) in the firewall:
  ```bash
  sudo ufw allow 80,443,2775/tcp && sudo ufw enable
  ```
- DNS: `panel.example.com` → server IP, `smpp.example.com` → server IP.

## 2. First deploy

```bash
git clone <repo> 8xtelsmpp && cd 8xtelsmpp
cp .env.prod.example .env
# Fill EVERY REQUIRED value. Generate secrets:
openssl rand -hex 32   # → JWT_SECRET
openssl rand -hex 32   # → VENDOR_SECRET_KEY
openssl rand -base64 18 # → BOOTSTRAP_ADMIN_PASSWORD, POSTGRES_PASSWORD
./scripts/deploy.sh
```

`deploy.sh` builds, starts postgres/redis, runs migrations, starts everything,
and prints the panel URL. Seed the admin **once** (re-running resets its password):

```bash
docker compose exec api node dist/db/seed.js
```

Log in at `https://panel.example.com` → rotate the bootstrap password immediately
(Users page or `docker compose exec api …` — then delete the plaintext from `.env`
history).

## 3. TLS (Let's Encrypt)

```bash
# Certs land in ./deploy/certs/ (mounted into the edge proxy)
docker compose run --rm --entrypoint sh edge -c \
  "apk add certbot && certbot certonly --webroot -w /var/www/certbot \
   -d panel.example.com --email admin@example.com --agree-tos --non-interactive"
mkdir -p deploy/certs
cp /var/lib/docker/volumes/*/_data 2>/dev/null; # — instead, copy manually:
#   fullchain.pem + privkey.pem from /etc/letsencrypt/live/panel.example.com/
#   into ./deploy/certs/, then:
docker compose restart edge
# Renew: certbot renew --deploy-hook "docker compose restart edge" (cron)
```

Until certs exist the edge proxy fails to start — that is expected. Either do
this step before first `up`, or temporarily comment the `edge` service, get
certs with standalone certbot, then bring it up.

## 4. Pilot wiring (1 real vendor)

1. **Vendors → Add**: host/port/system_id/password from your upstream. Set
   `connection_count: 1`, `tps` per their cap, status `enabled`.
2. Watch **Vendors → connections**: `connected` + `messages_sent` moving.
3. **Vendors → rates import**: their cost per country (CSV or API).
   Without costs, margin badges show "no cost on file" and profit reports are 0.
4. **Clients → Add**: pilot client, currency, TPS (start 50–100 for bulk).
   Top up wallet (Billing → Top up with remark).
5. **Routes → Add**: client = pilot, country, vendor chain, **price/seg above
   cost**, min margin % (e.g. 15). Red ⚠ badge = selling at a loss.
6. **Portal**: enable portal login for the client, hand them
   `https://panel.example.com/portal/login`.
7. **Send test SMS** (console) → watch Live traffic → confirm DLR `delivered`.

## 5. Daily ops

```bash
docker compose ps                        # all Up?
curl -sk https://panel.example.com/api/health
docker compose logs --tail=50 api vendor-worker routing-worker
./scripts/backup.sh                      # + cron at 03:00 (see script header)
```

Backups keep 14 days in `scripts/backups/`. Copy them off-server
(`scp`/S3) — a backup on the same disk is not a backup.

## 6. Updates

```bash
git pull
./scripts/deploy.sh   # rebuilds, migrates, restarts — seed NOT re-run
```

## Production checklist

- [ ] `.env` has no REQUIRED placeholders; secrets ≥ 32 random chars
- [ ] Bootstrap admin password rotated; plaintext removed from shell history
- [ ] TLS live on panel (https://… loads, no warnings)
- [ ] Postgres NOT published (no `5432:5432` in compose — internal only ✓)
- [ ] Redis NOT published (same ✓)
- [ ] Backup cron installed + one restore tested
- [ ] Vendor costs imported; route prices above cost; margins set
- [ ] Pilot client TPS + wallet funded; portal login handed off
- [ ] `messages`/`message_events` partitioning planned once volume grows:
  `CREATE TABLE messages_2026_09 PARTITION OF messages FOR VALUES FROM (...) TO (...)`
- [ ] Monitoring: `/api/health`, queue depth (`bull:sms-*:wait`), TPS,
  DLR latency, delivery ratio — alert before clients notice

## Backups

```bash
./scripts/backup.sh
# Restore: gunzip -c scripts/backups/xtelsmpp-<date>.sql.gz \
#   | docker compose exec -T postgres psql -U xtel xtelsmpp
```
