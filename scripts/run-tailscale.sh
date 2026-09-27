#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

export DRAFTS_MCP_BRIDGE_ROOT="$ROOT_DIR"
exec "$ROOT_DIR/scripts/drafts-mcp-bridge.sh" "$@"
