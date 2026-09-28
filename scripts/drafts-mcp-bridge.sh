#!/usr/bin/env sh
set -eu

ROOT_DIR="${DRAFTS_MCP_BRIDGE_ROOT:-}"
if [ -z "$ROOT_DIR" ]; then
  ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
fi

if [ -z "${DRAFTS_MCP_ENV_FILE:-}" ] && [ -f "$ROOT_DIR/.env" ]; then
  export DRAFTS_MCP_ENV_FILE="$ROOT_DIR/.env"
fi

if [ -f "$ROOT_DIR/dist/index.mjs" ]; then
  exec node "$ROOT_DIR/dist/index.mjs" "$@"
fi

pnpm --dir "$ROOT_DIR" run build
exec node "$ROOT_DIR/dist/index.js" "$@"
