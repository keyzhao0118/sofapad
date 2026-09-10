#!/bin/bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
NODE_BINARY="${NODE_BINARY:-node}"
PYTHON_BINARY="${PYTHON_BINARY:-python3}"
"$NODE_BINARY" Web/node_modules/typescript/bin/tsc -p Web/tsconfig.json
(cd Web && "$NODE_BINARY" build.mjs)
"$NODE_BINARY" --test Web/tests/*.test.mjs
swift test --cache-path .build/cache --config-path .build/config --security-path .build/security
"$PYTHON_BINARY" Tests/Integration/server_test.py
