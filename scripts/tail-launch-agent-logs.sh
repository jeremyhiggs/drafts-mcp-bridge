#!/usr/bin/env sh
set -eu

LOG_DIR="$HOME/Library/Logs/drafts-mcp-bridge"
STDOUT_LOG="$LOG_DIR/out.log"
STDERR_LOG="$LOG_DIR/err.log"

mkdir -p "$LOG_DIR"
touch "$STDOUT_LOG" "$STDERR_LOG"

echo "Tailing Drafts MCP bridge logs. Press Ctrl-C to stop."
echo "stdout: $STDOUT_LOG"
echo "stderr: $STDERR_LOG"

tail -n 200 -f "$STDOUT_LOG" "$STDERR_LOG"
