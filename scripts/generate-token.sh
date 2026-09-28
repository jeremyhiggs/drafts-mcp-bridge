#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f dist/generate-token.mjs ]; then
  exec node dist/generate-token.mjs "$@"
fi

pnpm run build

exec node dist/generate-token.js "$@"
