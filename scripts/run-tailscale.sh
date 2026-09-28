#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

export DRAFTS_MCP_BRIDGE_ROOT="$ROOT_DIR"
export DRAFTS_MCP_TAILSCALE_SERVE=true
exec "$ROOT_DIR/scripts/drafts-mcp-bridge.sh" "$@"
