#!/bin/bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
NODE_BINARY="${NODE_BINARY:-node}"
PNPM_BINARY="${PNPM_BINARY:-pnpm}"
PYTHON_BINARY="${PYTHON_BINARY:-python3}"
# Restricted or nested sandboxes may need SWIFT_TEST_FLAGS=--disable-sandbox.
SWIFT_TEST_FLAGS="${SWIFT_TEST_FLAGS:-}"
if [ ! -f Web/node_modules/typescript/bin/tsc ]; then
  "$PNPM_BINARY" install --dir Web --frozen-lockfile
fi
"$NODE_BINARY" Web/node_modules/typescript/bin/tsc -p Web/tsconfig.json
(cd Web && "$NODE_BINARY" build.mjs)
"$NODE_BINARY" --test Web/tests/*.test.mjs
# Unquoted on purpose: an empty value must expand to no argument.
# shellcheck disable=SC2086
swift test $SWIFT_TEST_FLAGS --cache-path .build/cache --config-path .build/config --security-path .build/security
"$PYTHON_BINARY" Tests/Integration/server_test.py
