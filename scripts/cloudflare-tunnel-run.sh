#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_CFG="$ROOT_DIR/.cloudflared/config.yml"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is required. Install with: brew install cloudflared"
  exit 1
fi

if [[ ! -f "$PROJECT_CFG" ]]; then
  echo "Missing $PROJECT_CFG. Run scripts/cloudflare-tunnel-setup.sh first."
  exit 1
fi

TUNNEL_REF="$(awk '/^tunnel:/{print $2; exit}' "$PROJECT_CFG")"
if [[ -z "$TUNNEL_REF" ]]; then
  echo "Could not resolve tunnel ID from $PROJECT_CFG"
  exit 1
fi

cloudflared tunnel --config "$PROJECT_CFG" run "$TUNNEL_REF"
