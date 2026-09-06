# Go live: Spaceship domain + Hostinger VPS — end to end

**What "connect both and make everything live" means:** point the domain at
the server (DNS), then run this app on the server (Nginx + TLS + PM2).
There are 3 steps only you can click through (they need your accounts);
everything else is already prepared in this repo.

## What I already did (in this repo)

- `deploy/setup-vps.sh` — one script that installs Node 22, nginx, Certbot,
  PM2, clones/builds/starts the app, and issues the TLS certificate. Takes
  your domain as input — no hardcoding.
- `deploy/nginx-site.template.conf` — nginx vhost template (HTTP→HTTPS,
  cert paths, reverse-proxy to Next.js with streaming unbuffered).
- `deploy/DNS-SPACESHIP.md` — exact DNS records to add in Spaceship.
- `deploy/CLOUDFLARE.md` — optional later speedup, NOT required.
- `src/proxy.ts` — generic `www → apex` redirect for any domain.

## What you do (3 steps, ~30 min + DNS wait)

### 1. Get the VPS IP — Hostinger hPanel (~2 min)

hPanel → **VPS** → your server → copy the **Public IPv4**. Wait for the
"Setting up your VPS" progress (your screenshot showed 3%) to finish —
you'll get a "VPS ready" email. Note the root password from hPanel too
(or reset it there).

### 2. Point the domain — Spaceship DNS (~5 min + propagation wait)

Full click path in `deploy/DNS-SPACESHIP.md`. Short version: Domain List →
your domain → DNS → two A records (`@` and `www`) → your VPS IP.
Verify from your PC:

```bash
nslookup example.com        # must return your VPS IP
nslookup www.example.com    # must return your VPS IP
```

### 3. Deploy — SSH + one script (~10 min)

```bash
ssh root@<YOUR_VPS_IP>
git clone <your-github-repo-url> /var/www/app
cd /var/www/app
sudo bash deploy/setup-vps.sh
```

Answer the prompts (domain, email, repo URL). Then create the production env:

```bash
cp /var/www/app/.env.example /var/www/app/.env.local
nano /var/www/app/.env.local
```

Set at minimum:

```bash
NEXT_PUBLIC_APP_URL=https://<your-domain>
JWT_SECRET=<openssl rand -hex 32>
SESSION_SECRET=<openssl rand -hex 32>
NOWPAYMENTS_API_KEY=<from account.nowpayments.io>
NOWPAYMENTS_IPN_SECRET=<from NOWPayments IPN settings>
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
ADMIN_EMAILS=<your-email>
```

Then issue TLS + restart:

```bash
sudo certbot --nginx -d <your-domain> -d www.<your-domain> -m <your-email> --agree-tos --non-interactive
sudo DOMAIN=<your-domain> PORT=3000 bash deploy/setup-vps.sh
cd /var/www/app && pm2 restart app
```

### 4. Post-deploy checklist

- `https://<your-domain>` loads (no cert warning).
- Google Cloud Console → Credentials → OAuth client → add authorized
  redirect URI: `https://<your-domain>/api/auth/google/callback`.
- NOWPayments dashboard → IPN callback URL:
  `https://<your-domain>/api/payments/crypto/webhook`.
- `pm2 status` shows `app` as online; `pm2 logs app` has no errors.
- Reboots survive: `pm2 startup` was configured by the script.

## Updating later

```bash
ssh root@<YOUR_VPS_IP>
cd /var/www/app && git pull --ff-only && npm ci && npm run build && pm2 restart app
```

## Optional: Cloudflare

Only if you want a global cache in front of the VPS. See
`deploy/CLOUDFLARE.md`. Skip it for launch — direct DNS is simpler and
webhooks/OAuth work with zero extra settings.
