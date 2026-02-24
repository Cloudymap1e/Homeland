#!/usr/bin/env bash
set -euo pipefail

TUNNEL_NAME="homeland-web"
HOSTNAME="homeland.secana.top"
ORIGIN="http://127.0.0.1:4173"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is required. Install with: brew install cloudflared"
  exit 1
fi

mkdir -p "$HOME/.cloudflared"

if [[ ! -f "$HOME/.cloudflared/cert.pem" ]]; then
  echo "No Cloudflare origin cert found. Starting login..."
  cloudflared tunnel login
fi

echo "Creating tunnel if it does not exist..."
if ! cloudflared tunnel info "$TUNNEL_NAME" >/dev/null 2>&1; then
  cloudflared tunnel create "$TUNNEL_NAME"
fi

TUNNEL_ID="$(cloudflared tunnel list --output json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next((t["id"] for t in d if t["name"]=="homeland-web"), ""))')"
if [[ -z "$TUNNEL_ID" ]]; then
  echo "Could not resolve tunnel ID for $TUNNEL_NAME"
  exit 1
fi

cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME"

cat > "$HOME/.cloudflared/config.yml" <<CFG
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json

ingress:
  - hostname: $HOSTNAME
    service: $ORIGIN
  - service: http_status:404
CFG

echo "Tunnel setup complete."
echo "Next steps:"
echo "  1) npm run dev"
echo "  2) cloudflared tunnel run $TUNNEL_NAME"
