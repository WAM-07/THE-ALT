#!/usr/bin/env bash
# One-time preparation of the ALT beta server (Ubuntu 24.04), run as root:  bash setup.sh <public-host>
# Installs Node.js 22, PostgreSQL and Caddy (HTTPS), creates the `alt` user and its directories, the database,
# the firewall (SSH, HTTP, HTTPS only) and the alt-beta service. Safe to run again.
set -euo pipefail
HOST="${1:?usage: setup.sh <public-host>}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg ufw postgresql debian-keyring debian-archive-keyring apt-transport-https

# Node.js 22 (NodeSource)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi

# Caddy (official repository): HTTPS certificates from Let's Encrypt, renewed automatically
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy
fi

# Swap, so building the Next.js apps fits in 4 GB
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# The service user and its directories: code in /opt/alt, data in /var/lib/alt, secrets in /etc/alt
id alt >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/alt --shell /bin/bash alt
mkdir -p /opt/alt /var/lib/alt /etc/alt
chown -R alt:alt /opt/alt /var/lib/alt
chown root:alt /etc/alt
chmod 750 /var/lib/alt /etc/alt

# PostgreSQL: a role and database for the beta (password generated once, kept in /etc/alt/db.env)
if [ ! -f /etc/alt/db.env ]; then
  DBPW="$(openssl rand -hex 24)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE alt LOGIN PASSWORD '${DBPW}';"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE alt_beta OWNER alt;"
  echo "DATABASE_URL=postgres://alt:${DBPW}@127.0.0.1:5432/alt_beta" > /etc/alt/db.env
fi
chown root:alt /etc/alt/db.env && chmod 640 /etc/alt/db.env

# Firewall: only SSH, HTTP and HTTPS reach the machine; every ALT port listens on 127.0.0.1 anyway.
# Oracle Cloud's Ubuntu images come with their own iptables rules (everything but SSH rejected): open 80 and 443
# there. Elsewhere, ufw.
if command -v netfilter-persistent >/dev/null && iptables -S INPUT | grep -q REJECT; then
  for port in 80 443; do
    iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null ||
      iptables -I INPUT "$(iptables -L INPUT --line-numbers | awk '/REJECT/ {print $1; exit}')" -p tcp -m state --state NEW --dport "$port" -j ACCEPT
  done
  netfilter-persistent save >/dev/null
else
  ufw allow OpenSSH >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

# HTTPS in front of the gateway
cat > /etc/caddy/Caddyfile <<EOF
${HOST} {
	encode gzip
	request_body {
		max_size 30MB
	}
	reverse_proxy 127.0.0.1:8080
}
EOF
systemctl reload caddy || systemctl restart caddy

# The beta itself (started once the code is deployed and the demo story is built)
cat > /etc/systemd/system/alt-beta.service <<'EOF'
[Unit]
Description=The ALT Ecosystem (beta)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=alt
WorkingDirectory=/opt/alt/app
EnvironmentFile=/etc/alt/db.env
Environment=ALT_ENV_FILE=/etc/alt/beta.env
Environment=ALT_STATE_DIR=/var/lib/alt
ExecStart=/usr/bin/node deploy/beta/start.mjs
Restart=always
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
echo "setup done for https://${HOST}"
