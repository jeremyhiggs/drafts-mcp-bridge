#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"
export DRAFTS_MCP_TAILSCALE_SERVE=false

if [ -f dist/index.mjs ]; then
  exec node dist/index.mjs "$@"
fi

pnpm run build

exec node dist/index.js "$@"
