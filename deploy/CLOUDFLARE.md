# Cloudflare setup for yosender.com (free plan)

Why: with worldwide users, Cloudflare's 300+ edge locations cache the
landing page, pricing, `_next/static` JS/CSS and images close to each
visitor — a US user loads the site from the US even though the VPS is in
one city. Only logins, campaigns and payment callbacks hit the origin VPS.

## 1) Add the site (dashboard, ~10 min)

1. https://dash.cloudflare.com → Add domain → `yosender.com` → Free plan.
2. Cloudflare shows 2 nameservers (e.g. `*.ns.cloudflare.com`).
3. At your domain registrar (where yosender.com lives): replace the
   nameservers with Cloudflare's two. Wait 5–60 min for activation email.

## 2) DNS records (must be exact)

| Type | Name | Content        | Proxy |
| ---- | ---- | -------------- | ----- |
| A    | @    | `<YOUR_VPS_IP>` | ✅ Proxied (orange cloud) |
| A    | www  | `<YOUR_VPS_IP>` | ✅ Proxied (orange cloud) |

Also delete any other A/AAAA records for @ / www. IPv6 (AAAA) only if your
VPS actually has IPv6 — otherwise it breaks half the world. No MX/TXT
changes needed unless you use email on this domain.

Where is `<YOUR_VPS_IP>`? Hostinger hPanel → VPS → Public IP (IPv4).

## 3) SSL/TLS — the setting that breaks webhooks if wrong

SSL/TLS → Overview → set **`Full (strict)`**.

- `Flexible` breaks Google OAuth + NOWPayments callbacks (origin sees http).
- `Full (strict)` requires a valid cert on the VPS — we issue it with
  Certbot in `setup-vps.sh` (`/etc/letsencrypt/live/yosender.com/`), and the
  nginx config already points at it. Origin keeps its own Let's Encrypt cert;
  Cloudflare adds the edge cert automatically.
- Edge Certificates tab: leave defaults (Universal SSL ON, always use HTTPS ON).

Corresponding `src/proxy.ts` redirects `www → apex` so there is one
canonical URL for cookies/OAuth/IPN.

## 4) Caching — cache static, NEVER cache the app logic

Speed → Optimization: leave defaults. Caching → Configuration:

- Caching Level: **Standard**, Browser Cache TTL: **Respect Existing Headers**.
- **Page Rules (free plan has 3 — you need 2):**

  1. `yosender.com/api/*` → **Cache Level: Bypass** (payment webhooks,
     Telegram OTP/send-code, campaign sends must always reach the VPS).
  2. `yosender.com/*` → **Cache Level: Standard** (lets Cloudflare cache
     `_next/static/*` immutable JS/CSS + images; HTML pages already send
     `private, no-cache` when dynamic, per Next.js self-hosting behavior, so
     logged-in pages are never served to the wrong user).

Do NOT create a rule that caches `/api/*` or "Cache Everything" on `/` —
users would see each other's dashboards and NOWPayments IPN would 404/stall.

`next.config.ts` already sends `Cache-Control: no-store` on `/api/*` as a
second layer, so even a misconfigured rule fails safe.

## 5) Security (recommended, free)

- Security → Settings: Security Level **Medium**, Bot Fight Mode **ON**.
- Security → WAF → Managed ruleset: ON (free rules) — blocks obvious bots
  from hammering `/api/telegram/send-code` (OTP costs you Telegram flood risk).
- If OTP abuse appears later: add a rate-limit rule for
  `/api/telegram/send-code` (e.g. 5 req / 10 min / IP).

## 6) Verify (after DNS + Certbot are done)

```bash
curl -sI https://yosender.com | grep -i -E "HTTP|cf-ray|strict-transport"
curl -s https://yosender.com/api/payments/crypto/webhook
```

- First should show `HTTP/2 200` + a `cf-ray` header (traffic via Cloudflare).
- Second should return `{"ok":true,"message":"NOWPayments webhook…"}`.
- In NOWPayments dashboard set IPN callback to
  `https://yosender.com/api/payments/crypto/webhook`.
- In Google Cloud Console add authorized redirect URI
  `https://yosender.com/api/auth/google/callback`.

Under Attack Mode: leave OFF except during an active DDoS (it adds a
challenge page that also blocks NOWPayments IPN).
