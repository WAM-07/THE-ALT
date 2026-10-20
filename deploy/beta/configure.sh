#!/usr/bin/env bash
# Writes the beta server's settings (/etc/alt/beta.env) from .env.beta and uploads them. Run from the repository
# root in Git Bash after setup.sh:  bash deploy/beta/configure.sh   (again after changing .env.beta, then restart)
set -euo pipefail
cd "$(dirname "$0")/../.."
val() { grep -E "^$1=" .env.beta | cut -d= -f2- | tr -d '\r'; }
IP="$(val BETA_SERVER_IP)"; USR="$(val BETA_SSH_USER)"; USR="${USR:-ubuntu}"; MAIL="$(val BETA_GMAIL_ADDRESS)"; APPPW="$(val BETA_GMAIL_APP_PASSWORD | tr -d ' ')"
DEMOPW="$(val BETA_DEMO_PASSWORD)"; GROQ="$(val BETA_GROQ_API_KEY)"; GEMINI="$(val BETA_GEMINI_API_KEY)"
for v in IP MAIL APPPW DEMOPW GROQ; do [ -n "${!v}" ] || { echo "$v is empty in .env.beta"; exit 1; }; done
HOST="${IP//./-}.sslip.io"
OUT="$(mktemp)"
cat > "$OUT" <<EOF
# ALT beta server settings, written by deploy/beta/configure.sh from .env.beta
ALT_PUBLIC_URL=https://${HOST}
MAIL_MODE=smtp
SMTP_URL=smtps://${MAIL/@/%40}:${APPPW}@smtp.gmail.com:465
MAIL_FROM=ALT Beta <${MAIL}>
GROQ_API_KEY=${GROQ}
GEMINI_API_KEY=${GEMINI}
ADMIN_EMAILS=admin@demo.alt
ALT_DEMO_PASSWORD=${DEMOPW}
STARTER_TEST_POL=100
EOF
scp -i "$HOME/.ssh/alt_beta" -q "$OUT" "$USR@$IP:/tmp/beta.env"
rm -f "$OUT"
ssh -i "$HOME/.ssh/alt_beta" "$USR@$IP" 'sudo install -o root -g alt -m 640 /tmp/beta.env /etc/alt/beta.env && rm -f /tmp/beta.env'
echo "settings uploaded for https://${HOST}"
