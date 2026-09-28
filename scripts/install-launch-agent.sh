#!/usr/bin/env sh
set -eu

LABEL="local.drafts-mcp-bridge"

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
if [ "$#" -gt 1 ]; then
  echo "Usage: $0 [release-folder]" >&2
  exit 1
fi
if [ ! -f "$ROOT_DIR/dist/tailscale-start.mjs" ]; then
  ROOT_DIR="$ROOT_DIR/release/drafts-mcp-bridge"
fi
ROOT_DIR="${1:-$ROOT_DIR}"
if [ ! -f "$ROOT_DIR/dist/tailscale-start.mjs" ] || [ ! -f "$ROOT_DIR/dist/config.mjs" ]; then
  echo "Missing release folder. Run pnpm release first, or pass a release-folder path." >&2
  exit 1
fi
ROOT_DIR="$(CDPATH= cd -- "$ROOT_DIR" && pwd)"
cd "$ROOT_DIR"
TEMPLATE="$ROOT_DIR/launchd/$LABEL.plist.template"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SERVICE_DIR="$HOME/Library/Application Support/drafts-mcp-bridge"
RELEASES_DIR="$SERVICE_DIR/releases"
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
      -e "s/'/\&apos;/g" \
    | sed 's/[\\&#]/\\&/g'
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

RELEASE_VERSION="$(node -e '
const pkg = require(process.argv[1]);
const version = `${pkg.version}+${pkg.buildId}`;
if (!pkg.buildId || !/^[A-Za-z0-9.+_-]+$/.test(version)) process.exit(1);
process.stdout.write(version);
' "$ROOT_DIR/package.json")"
mkdir -p "$RELEASES_DIR"
LOCK_DIR="$SERVICE_DIR/.install.lock"
if ! mkdir "$LOCK_DIR"; then
  echo "Another install is running, or $LOCK_DIR is stale." >&2
  exit 1
fi
NEW_RELEASE=""
cleanup() {
  if [ -n "$NEW_RELEASE" ]; then rm -rf "$NEW_RELEASE"; fi
  rmdir "$LOCK_DIR"
}
trap cleanup EXIT
SOURCE_ROOT="$ROOT_DIR"
ROOT_DIR="$(mktemp -d "$RELEASES_DIR/$RELEASE_VERSION.XXXXXX")"
NEW_RELEASE="$ROOT_DIR"
for part in dist scripts launchd README.md .env.example package.json THIRD_PARTY_NOTICES.txt; do
  cp -R "$SOURCE_ROOT/$part" "$ROOT_DIR/"
done
cd "$ROOT_DIR"
SOURCE_LAUNCHER_PATH="$ROOT_DIR/scripts/drafts-mcp-bridge.sh"
CONFIG_MODULE="$ROOT_DIR/dist/config.mjs"

CONFIG_HOME="$(node --input-type=module - "$CONFIG_MODULE" <<'NODE'
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
const { defaultTokenFile, loadConfig, loadEffectiveEnv } = await import(pathToFileURL(process.argv[2]).href);
loadConfig();
console.log(dirname(dirname(defaultTokenFile(loadEffectiveEnv()))));
NODE
)"

mkdir -p "$HOME/Library/LaunchAgents" "$SERVICE_DIR" "$LOG_DIR"
NEW_RELEASE=""
cp "$SOURCE_LAUNCHER_PATH" "$LAUNCHER_PATH"
chmod 755 "$LAUNCHER_PATH"
render_template > "$PLIST"
plutil -lint "$PLIST" >/dev/null

launchctl bootout "$GUI_DOMAIN/$LABEL" >/dev/null 2>&1 || true
wait_for_service_removal
bootstrap_launch_agent
launchctl enable "$GUI_DOMAIN/$LABEL"
launchctl kickstart -k "$GUI_DOMAIN/$LABEL"
attempts=0
until launchctl print "$GUI_DOMAIN/$LABEL" | grep -q 'state = running'; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 10 ]; then
    echo "Timed out waiting for $LABEL to run; previous releases were kept." >&2
    exit 1
  fi
  sleep 1
done

for old_release in "$RELEASES_DIR"/*; do
  if [ -d "$old_release" ] && [ "$old_release" != "$ROOT_DIR" ]; then
    rm -rf "$old_release"
  fi
done

echo "Installed and started $LABEL"
echo "Plist: $PLIST"
echo "Launcher: $LAUNCHER_PATH"
echo "Logs:  $LOG_DIR"
