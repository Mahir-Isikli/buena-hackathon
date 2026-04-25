#!/usr/bin/env bash
# Tail a Cloudflare Worker with a heartbeat so the pi process harness
# doesn't reap the process during silent periods.
#
# Usage: ./scripts/tail-worker.sh [worker-name] [extra wrangler args...]
# Default worker: buena-ingest
set -euo pipefail

WORKER="${1:-buena-ingest}"
shift || true

CLOUDFLARE_API_TOKEN="$(security find-generic-password -s cloudflare-buena-token -w)"
CLOUDFLARE_ACCOUNT_ID="$(security find-generic-password -s cloudflare-account-id -w)"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

# Heartbeat every 20s so stdout never goes silent.
( while true; do echo "[heartbeat $(date -u +%H:%M:%SZ)]"; sleep 20; done ) &
HEARTBEAT_PID=$!
trap 'kill "$HEARTBEAT_PID" 2>/dev/null || true' EXIT

cd "$(dirname "$0")/../workers/ingest"
exec npx wrangler tail "$WORKER" --format pretty "$@"
