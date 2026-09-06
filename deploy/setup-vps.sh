#!/usr/bin/env bash
# Generic VPS setup — run ONCE on a fresh Ubuntu VPS (24.04 / 26.04 LTS, Hostinger KVM 1+).
# Wires Nginx + TLS + PM2 for any Next.js app + any domain.
#
# Usage:
#   sudo bash deploy/setup-vps.sh
#
# The script asks for:
#   1. DOMAIN      e.g. example.com            (no https, no www)
#   2. EMAIL       e.g. you@example.com        (Let's Encrypt notices)
#   3. REPO_URL    e.g. https://github.com/you/app.git (empty = copy files via scp)
#   4. APP_DIR     default /var/www/app
#   5. PORT        default 3000
#
# What it does:
#   [1] installs Node 22, nginx, certbot, pm2
#   [2] opens firewall (SSH + HTTP/HTTPS only)
#   [3] clones/pulls the repo into APP_DIR
#   [4] npm ci + npm run build + pm2 start (survives reboots)
#   [5] installs nginx site from nginx-site.template.conf
#   [6] issues Let's Encrypt cert (needs DNS already pointing here — see DNS-SPACESHIP.md)
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash deploy/setup-vps.sh" >&2
  exit 1
fi

TEMPLATE_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_USER="${SUDO_USER:-root}"
APP_USER_HOME="$(eval echo "~$APP_USER")"

# ── Prompts (env vars also accepted: DOMAIN=example.com sudo -E bash deploy/setup-vps.sh) ──
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
REPO_URL="${REPO_URL:-}"
APP_DIR="${APP_DIR:-/var/www/app}"
PORT="${PORT:-3000}"

[ -z "$DOMAIN" ] && read -rp "Domain (apex, e.g. example.com): " DOMAIN
[ -z "$EMAIL" ] && read -rp "Email for Let's Encrypt notices: " EMAIL
if [ -z "$REPO_URL" ]; then
  echo "Repo URL (leave empty if you will upload files with scp instead):"
  read -rp "Git repo URL: " REPO_URL
fi
read -rp "App directory [$APP_DIR]: " _d; APP_DIR="${_d:-$APP_DIR}"
read -rp "Next.js port [$PORT]: " _p; PORT="${_p:-$PORT}"

# Normalize: strip protocol / www / trailing slash
DOMAIN="$(echo "$DOMAIN" | sed -E 's#^https?://##; s#^www\.##; s#/.*##')"
echo "==> Domain: $DOMAIN | App: $APP_DIR | Port: $PORT | User: $APP_USER"

echo "==> [1/6] System packages (Node 22, nginx, certbot, pm2)..."
apt-get update -y
apt-get install -y curl git nginx certbot python3-certbot-nginx ufw
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

echo "==> [2/6] Firewall (SSH + HTTP/HTTPS only)..."
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 'Nginx Full' >/dev/null 2>&1 || true
ufw --force enable

echo "==> [3/6] App code..."
mkdir -p "$APP_DIR" /var/www/html
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
if [ -n "$REPO_URL" ]; then
  if [ ! -d "$APP_DIR/.git" ]; then
    su "$APP_USER" -c "git clone '$REPO_URL' '$APP_DIR'"
  else
    su "$APP_USER" -c "cd '$APP_DIR' && git pull --ff-only"
  fi
elif [ -z "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
  echo "    ⚠️  $APP_DIR is empty and no repo URL given."
  echo "    Upload from your PC, then re-run this script:"
  echo "       scp -r ./* root@<VPS_IP>:$APP_DIR/"
  echo "    (or set a GitHub repo and clone it here)"
fi

echo "==> [4/6] Nginx site..."
sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$PORT/g" \
  "$TEMPLATE_DIR/nginx-site.template.conf" > /etc/nginx/sites-available/app
# HTTP-only for now (certbot adds TLS). If a cert already exists, keep full config.
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  ln -sf /etc/nginx/sites-available/app /etc/nginx/sites-enabled/app
else
  # Temporary HTTP-only vhost so the site + ACME challenge work pre-cert
  cat > /etc/nginx/sites-enabled/app <<EOF
server {
  listen 80;
  server_name $DOMAIN www.$DOMAIN;
  location /.well-known/acme-challenge/ { root /var/www/html; }
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;
    proxy_request_buffering off;
  }
}
EOF
fi
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

if [ -f "$APP_DIR/package.json" ]; then
  echo "==> [5/6] Build + start (PM2)..."
  su "$APP_USER" -c "cd '$APP_DIR' && npm ci && npm run build"
  # Persistent local JSON db dir (app stores .data/ next to the code)
  su "$APP_USER" -c "mkdir -p '$APP_DIR/.data'"
  su "$APP_USER" -c "cd '$APP_DIR' && pm2 delete app 2>/dev/null || true && pm2 start npm --name app -- start -- -p '$PORT' && pm2 save"
  pm2 startup systemd -u "$APP_USER" --hp "$APP_USER_HOME" >/dev/null 2>&1 || true
else
  echo "    ⏭️  No package.json in $APP_DIR yet — skipping build (re-run after uploading code)."
fi

echo "==> [6/6] TLS..."
echo "    DNS must already resolve to this server (see deploy/DNS-SPACESHIP.md):"
echo "       dig +short $DOMAIN   # should print this VPS public IP"
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "    ✅ Cert already exists for $DOMAIN — installing full nginx config."
  sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$PORT/g" \
    "$TEMPLATE_DIR/nginx-site.template.conf" > /etc/nginx/sites-available/app
  ln -sf /etc/nginx/sites-available/app /etc/nginx/sites-enabled/app
  nginx -t && systemctl reload nginx
else
  echo "    Run once DNS propagates:"
  echo "       sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN -m $EMAIL --agree-tos --non-interactive"
  echo "    Then install the full TLS vhost:"
  echo "       sudo DOMAIN=$DOMAIN PORT=$PORT bash deploy/setup-vps.sh"
fi

echo ""
echo "==> .env on the VPS — create $APP_DIR/.env.local with:"
echo "    NEXT_PUBLIC_APP_URL=https://$DOMAIN"
echo "    NOWPAYMENTS_API_KEY / NOWPAYMENTS_IPN_SECRET"
echo "    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (redirect: https://$DOMAIN/api/auth/google/callback)"
echo "    JWT_SECRET / SESSION_SECRET (long random strings — generate with: openssl rand -hex 32)"
echo "    Then: cd $APP_DIR && pm2 restart app"
echo "Done."
