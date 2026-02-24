#!/usr/bin/env bash
set -euo pipefail

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is required. Install with: brew install cloudflared"
  exit 1
fi

if [[ ! -f "$HOME/.cloudflared/config.yml" ]]; then
  echo "Missing $HOME/.cloudflared/config.yml. Run scripts/cloudflare-tunnel-setup.sh first."
  exit 1
fi

cloudflared tunnel run homeland-web
