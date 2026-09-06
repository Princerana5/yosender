# Connect a Spaceship domain to a Hostinger VPS (KVM 1)

You bought the domain at Spaceship and the server at Hostinger. Connecting
them = telling Spaceship "this domain lives at this server IP" via 2 DNS
records. No Cloudflare needed.

## Step 1 — Get your VPS public IP (~1 min)

1. Open Hostinger hPanel → **VPS** → click your server.
2. Copy the **Public IP (IPv4)** — looks like `72.62.11.204`.
   (Ignore IPv6 unless you specifically ordered it.)
3. Make sure the VPS shows **Running / Active**. Your screenshot showed
   "Setting up your VPS … 3%" — wait for the "ready" email before continuing.

## Step 2 — Point the domain at the VPS in Spaceship (~5 min + propagation)

1. Go to https://www.spaceship.com → **Domain List** → click your domain →
   **DNS** (or "Advanced DNS").
2. Delete any existing `A` records for `@` and `www` that point elsewhere
   (parking pages, etc.). Leave `MX`/`TXT` alone unless you use domain email.
3. Add exactly these two records (replace `72.62.11.204` with YOUR VPS IP):

   | Type | Host | Value          | TTL     |
   | ---- | ---- | -------------- | ------- |
   | A    | @    | `72.62.11.204` | 1 hour  |
   | A    | www  | `72.62.11.204` | 1 hour  |

   Notes:
   - `@` = the apex domain (`example.com`). `www` = `www.example.com`.
   - No CNAME needed. No AAAA (IPv6) unless your VPS has IPv6.
   - TTL "1 hour" (or Automatic) is fine.

4. Save. DNS propagates in ~5–60 min (sometimes up to 24h).

## Step 3 — Verify DNS from your PC

```bash
nslookup example.com
nslookup www.example.com
```

Both must return YOUR VPS IP. Or:

```bash
dig +short example.com
dig +short www.example.com
```

If they still show old values, wait — nothing on the VPS side will work
(Certbot especially) until this resolves correctly.

## Step 4 — Deploy the app on the VPS

SSH into the VPS, then run the setup script from this repo:

```bash
ssh root@72.62.11.204
git clone <your-github-repo-url> /var/www/app
cd /var/www/app
sudo bash deploy/setup-vps.sh
```

The script asks for your domain + email, installs Node/nginx/PM2, builds the
app, starts it, and prints the Certbot command for TLS. Full details are in
`deploy/README-DEPLOY.md`.

## Troubleshooting

- **Site shows Hostinger default page** → DNS hasn't propagated yet, or the
  nginx site isn't installed. Check `dig +short example.com` first.
- **Certbot fails ("could not resolve" / "connection refused")** → DNS isn't
  pointing here yet, or firewall blocks port 80. Fix DNS, wait, retry.
- **www works but apex doesn't (or vice versa)** → you missed one of the two
  A records. Both `@` and `www` are required.
- **Spaceship shows "nameserver" options** → ignore; keep Spaceship's default
  nameservers and just edit the DNS records above. (Switching to Cloudflare
  nameservers is optional — see `deploy/CLOUDFLARE.md`.)
