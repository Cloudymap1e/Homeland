#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT_DIR/scripts/cuda/wave_sim.cu"
OUT_DIR="$ROOT_DIR/scripts/cuda/bin"
OUT_BIN="$OUT_DIR/wave_sim"

mkdir -p "$OUT_DIR"

if ! command -v nvcc >/dev/null 2>&1; then
  echo "nvcc not found. Install CUDA toolkit or run this on GS75." >&2
  exit 1
fi

nvcc -O3 -std=c++17 "$SRC" -o "$OUT_BIN"
chmod +x "$OUT_BIN"

echo "Built GPU wave simulator: $OUT_BIN"
