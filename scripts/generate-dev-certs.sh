#!/usr/bin/env bash
# Generates a self-signed TLS cert + key for local Docker Compose testing.
# NOT for real production use - once a real domain/server exists, switch
# nginx/conf.d/tejoma.conf to the certbot-issued cert instead (see DEPLOYMENT.md).
#
# Usage: bash scripts/generate-dev-certs.sh
set -euo pipefail

CERT_DIR="$(dirname "$0")/../nginx/certs"
mkdir -p "$CERT_DIR"

if [[ -f "$CERT_DIR/cert.pem" && -f "$CERT_DIR/key.pem" ]]; then
  echo "Certs already exist at $CERT_DIR - remove them first if you want to regenerate."
  exit 0
fi

# MSYS_NO_PATHCONV avoids Git Bash mangling "/CN=localhost" into a filesystem path.
MSYS_NO_PATHCONV=1 openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -days 365 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "Self-signed dev cert written to $CERT_DIR/cert.pem and $CERT_DIR/key.pem"
echo "Browsers will show a certificate warning for this cert - that's expected for local dev."
