#!/usr/bin/env sh
set -eu

LABEL="local.drafts-mcp-bridge"

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
case "$CONFIG_HOME" in
  /*) ;;
  *) echo "XDG_CONFIG_HOME must be an absolute path." >&2; exit 1 ;;
esac
TEMPLATE="$ROOT_DIR/launchd/$LABEL.plist.template"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SERVICE_DIR="$HOME/Library/Application Support/drafts-mcp-bridge"
LOG_DIR="$HOME/Library/Logs/drafts-mcp-bridge"
STDOUT_LOG="$LOG_DIR/out.log"
STDERR_LOG="$LOG_DIR/err.log"
GUI_DOMAIN="gui/$(id -u)"
NODE_PATH=""
TAILSCALE_PATH=""
SOURCE_LAUNCHER_PATH="$ROOT_DIR/scripts/drafts-mcp-bridge.sh"
LAUNCHER_PATH=""
SERVICE_PATH=""

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

xml_escape() {
  printf '%s' "$1" \
    | sed \
      -e 's/&/\&amp;/g' \
      -e 's/</\&lt;/g' \
      -e 's/>/\&gt;/g' \
      -e 's/"/\&quot;/g' \
      -e "s/'/\&apos;/g"
}

render_template() {
  sed \
    -e "s#__LABEL__#$(xml_escape "$LABEL")#g" \
    -e "s#__REPO_ROOT__#$(xml_escape "$ROOT_DIR")#g" \
    -e "s#__WORKING_DIRECTORY__#$(xml_escape "$SERVICE_DIR")#g" \
    -e "s#__LAUNCHER__#$(xml_escape "$LAUNCHER_PATH")#g" \
    -e "s#__PATH__#$(xml_escape "$SERVICE_PATH")#g" \
    -e "s#__CONFIG_HOME__#$(xml_escape "$CONFIG_HOME")#g" \
    -e "s#__STDOUT_LOG__#$(xml_escape "$STDOUT_LOG")#g" \
    -e "s#__STDERR_LOG__#$(xml_escape "$STDERR_LOG")#g" \
    "$TEMPLATE"
}

wait_for_service_removal() {
  attempts=0
  while launchctl print "$GUI_DOMAIN/$LABEL" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 10 ]; then
      echo "Timed out waiting for $LABEL to stop." >&2
      return 1
    fi
    sleep 1
  done
}

bootstrap_launch_agent() {
  attempts=0
  while ! launchctl bootstrap "$GUI_DOMAIN" "$PLIST"; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 5 ]; then
      echo "Failed to bootstrap $LABEL after $attempts attempts." >&2
      return 1
    fi
    sleep 1
  done
}

if [ ! -f "$ROOT_DIR/dist/tailscale-start.mjs" ]; then
  require_command pnpm
fi
require_command node
require_command tailscale
require_command launchctl
require_command plutil

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "Node.js 24 or newer is required." >&2
  exit 1
fi

NODE_PATH="$(command -v node)"
TAILSCALE_PATH="$(command -v tailscale)"
LAUNCHER_PATH="$SERVICE_DIR/drafts-mcp-bridge.sh"
SERVICE_PATH="$(dirname "$NODE_PATH"):$(dirname "$TAILSCALE_PATH"):$PATH"

if [ ! -f "$CONFIG_HOME/drafts-mcp-bridge/token" ]; then
  echo "Missing default token file. Run: scripts/generate-token.sh" >&2
  exit 1
fi
node -e '
  const fs = require("node:fs");
  for (const [file, directory] of [[process.argv[1], true], [process.argv[1] + "/token", false]]) {
    const stat = fs.lstatSync(file);
    if ((directory ? !stat.isDirectory() : !stat.isFile()) || (stat.mode & 0o077) !== 0) {
      throw new Error("Token directory/file must be private (0700/0600) and not symbolic links.");
    }
  }
' "$CONFIG_HOME/drafts-mcp-bridge"

mkdir -p "$HOME/Library/LaunchAgents" "$SERVICE_DIR" "$LOG_DIR"
cp "$SOURCE_LAUNCHER_PATH" "$LAUNCHER_PATH"
chmod 755 "$LAUNCHER_PATH"
render_template > "$PLIST"
plutil -lint "$PLIST" >/dev/null

launchctl bootout "$GUI_DOMAIN/$LABEL" >/dev/null 2>&1 || true
wait_for_service_removal
bootstrap_launch_agent
launchctl enable "$GUI_DOMAIN/$LABEL"
launchctl kickstart -k "$GUI_DOMAIN/$LABEL"

echo "Installed and started $LABEL"
echo "Plist: $PLIST"
echo "Launcher: $LAUNCHER_PATH"
echo "Logs:  $LOG_DIR"
