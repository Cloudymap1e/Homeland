#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TUNNEL_NAME="homeland-web"
HOSTNAME="homeland.secana.top"
ORIGIN="http://127.0.0.1:4173"
HOME_CF_DIR="$HOME/.cloudflared"
PROJECT_CF_DIR="$ROOT_DIR/.cloudflared"
PROJECT_CFG="$PROJECT_CF_DIR/config.yml"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is required. Install with: brew install cloudflared"
  exit 1
fi

mkdir -p "$HOME_CF_DIR" "$PROJECT_CF_DIR"

write_project_config() {
  local tunnel_id="$1"
  local credentials_file="$2"
  cat > "$PROJECT_CFG" <<CFG
tunnel: $tunnel_id
credentials-file: $credentials_file

ingress:
  - hostname: $HOSTNAME
    service: $ORIGIN
  - service: http_status:404
CFG
}

if [[ -f "$HOME_CF_DIR/cert.pem" ]]; then
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

  HOME_CREDENTIALS_FILE="$HOME_CF_DIR/$TUNNEL_ID.json"
  if [[ ! -f "$HOME_CREDENTIALS_FILE" ]]; then
    echo "Missing credentials file: $HOME_CREDENTIALS_FILE"
    exit 1
  fi

  PROJECT_CREDENTIALS_FILE="$PROJECT_CF_DIR/$TUNNEL_ID.json"
  cp "$HOME_CREDENTIALS_FILE" "$PROJECT_CREDENTIALS_FILE"
  write_project_config "$TUNNEL_ID" "$PROJECT_CREDENTIALS_FILE"
else
  echo "No $HOME_CF_DIR/cert.pem found, skipping tunnel create/route."
  if [[ -f "$PROJECT_CFG" ]]; then
    PROJECT_TUNNEL_ID="$(awk '/^tunnel:/{print $2; exit}' "$PROJECT_CFG")"
    PROJECT_CREDENTIALS_FILE="$(awk '/^credentials-file:/{print $2; exit}' "$PROJECT_CFG")"
    if [[ -n "$PROJECT_TUNNEL_ID" && -n "$PROJECT_CREDENTIALS_FILE" && -f "$PROJECT_CREDENTIALS_FILE" ]]; then
      echo "Using existing project tunnel config at $PROJECT_CFG."
      echo "Tunnel setup complete."
      echo "Next steps:"
      echo "  1) npm run dev"
      echo "  2) ./scripts/cloudflare-tunnel-run.sh"
      exit 0
    fi
  fi

  if [[ -f "$HOME_CF_DIR/config.yml" ]]; then
    HOME_TUNNEL_ID="$(awk '/^tunnel:/{print $2; exit}' "$HOME_CF_DIR/config.yml")"
    HOME_CREDENTIALS_FILE="$(awk '/^credentials-file:/{print $2; exit}' "$HOME_CF_DIR/config.yml")"
    if [[ -n "$HOME_TUNNEL_ID" && -n "$HOME_CREDENTIALS_FILE" && -f "$HOME_CREDENTIALS_FILE" ]]; then
      PROJECT_CREDENTIALS_FILE="$PROJECT_CF_DIR/$HOME_TUNNEL_ID.json"
      cp "$HOME_CREDENTIALS_FILE" "$PROJECT_CREDENTIALS_FILE"
      write_project_config "$HOME_TUNNEL_ID" "$PROJECT_CREDENTIALS_FILE"
      echo "Reused existing local tunnel credentials for project-local config."
    else
      echo "Could not parse usable tunnel credentials from $HOME_CF_DIR/config.yml."
      echo "Run cloudflared tunnel login, then rerun this setup script."
      exit 1
    fi
  else
    echo "No project config and no reusable $HOME_CF_DIR/config.yml found."
    echo "Run cloudflared tunnel login, then rerun this setup script."
    exit 1
  fi
fi

echo "Tunnel setup complete. Project config: $PROJECT_CFG"
echo "Next steps:"
echo "  1) npm run dev"
echo "  2) ./scripts/cloudflare-tunnel-run.sh"
