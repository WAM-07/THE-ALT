#!/usr/bin/env bash
# Deploys the working tree to the ALT beta server. Run from the repository root in Git Bash:
#   bash deploy/beta/deploy.sh            update the code and restart the beta
#   bash deploy/beta/deploy.sh --seed     first deployment: also build the demo story before starting
# Reads BETA_SERVER_IP and BETA_SSH_USER from .env.beta and uses the SSH key ~/.ssh/alt_beta (the user has sudo).
set -euo pipefail
cd "$(dirname "$0")/../.."
IP="$(grep -E '^BETA_SERVER_IP=' .env.beta | cut -d= -f2- | tr -d '\r')"
[ -n "$IP" ] || { echo "BETA_SERVER_IP is empty in .env.beta"; exit 1; }
USR="$(grep -E '^BETA_SSH_USER=' .env.beta | cut -d= -f2- | tr -d '\r')"; USR="${USR:-ubuntu}"
SSH="ssh -i $HOME/.ssh/alt_beta -o StrictHostKeyChecking=accept-new $USR@$IP"

echo "packing the code…"
tar czf /tmp/alt-beta.tgz \
  --exclude=node_modules --exclude=.git --exclude=.data --exclude=_archive --exclude=docs --exclude=artifacts \
  --exclude=.next --exclude='.env' --exclude='.env.*' --exclude='apps/alter' --exclude='apps/altera' \
  --exclude='packages/alt_account' --exclude='packages/contracts/artifacts' --exclude='packages/contracts/cache' \
  --exclude='*.log' \
  package.json package-lock.json packages services apps scripts deploy
echo "uploading ($(du -h /tmp/alt-beta.tgz | cut -f1))…"
scp -i "$HOME/.ssh/alt_beta" -q /tmp/alt-beta.tgz "$USR@$IP:/tmp/alt-beta.tgz"

$SSH sudo bash -s -- "${1:-}" <<'REMOTE'
set -euo pipefail
SEED="$1"
rm -rf /opt/alt/app.new && mkdir -p /opt/alt/app.new
tar xzf /tmp/alt-beta.tgz -C /opt/alt/app.new && chown -R alt:alt /opt/alt/app.new
cd /opt/alt/app.new
echo "installing dependencies…"
sudo -u alt npm ci --no-audit --no-fund --loglevel=error
echo "building the contracts and the two websites…"
(cd packages/contracts && sudo -u alt node ../../node_modules/hardhat/dist/src/cli.js build >/dev/null)
(cd apps/altar-web && sudo -u alt NEXT_TELEMETRY_DISABLED=1 npx next build >/dev/null)
(cd apps/command-centre && sudo -u alt NEXT_TELEMETRY_DISABLED=1 npx next build >/dev/null)
systemctl stop alt-beta 2>/dev/null || true
rm -rf /opt/alt/app.old
[ -d /opt/alt/app ] && mv /opt/alt/app /opt/alt/app.old
mv /opt/alt/app.new /opt/alt/app
if [ "$SEED" = "--seed" ]; then
  echo "building the demo story (several minutes)…"
  # It runs in development mode (the development mailbox gives it the email codes), so nothing may reach it.
  systemctl stop caddy
  cd /opt/alt/app
  sudo -u alt env $(cat /etc/alt/db.env) ALT_ENV_FILE=/etc/alt/beta.env ALT_STATE_DIR=/var/lib/alt node deploy/beta/start.mjs --seed
  systemctl start caddy
fi
systemctl enable --now alt-beta
systemctl restart alt-beta
echo "deployed."
REMOTE
