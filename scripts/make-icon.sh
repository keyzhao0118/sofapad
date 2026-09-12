#!/bin/bash
# Regenerates MacApp/AppIcon.icns. Committed so normal builds need no extra step.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
ICONSET="build/AppIcon.iconset"
rm -rf "$ICONSET"
# Keep compiler caches inside the repo so restricted environments can run this too.
mkdir -p build/.clangcache build/.swiftcache
CLANG_MODULE_CACHE_PATH="$ROOT_DIR/build/.clangcache" SWIFT_MODULECACHE_PATH="$ROOT_DIR/build/.swiftcache" \
  swift scripts/make-icon.swift "$ICONSET"
iconutil -c icns "$ICONSET" -o MacApp/AppIcon.icns
echo "Wrote MacApp/AppIcon.icns"
