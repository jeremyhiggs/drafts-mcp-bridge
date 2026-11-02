#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f dist/check-bridge.mjs ]; then
  exec node dist/check-bridge.mjs "$@"
fi

pnpm run build

exec node dist/check-bridge.js "$@"
