#!/bin/bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
NODE_BINARY="${NODE_BINARY:-node}"
PNPM_BINARY="${PNPM_BINARY:-pnpm}"
CONFIGURATION="${CONFIGURATION:-release}"
if [ ! -f Web/node_modules/typescript/bin/tsc ]; then
  "$PNPM_BINARY" install --dir Web --frozen-lockfile
fi
"$NODE_BINARY" Web/node_modules/typescript/bin/tsc -p Web/tsconfig.json
(cd Web && "$NODE_BINARY" build.mjs)
swift build -c "$CONFIGURATION" --force-resolved-versions --cache-path .build/cache --config-path .build/config --security-path .build/security
BUILD_DIR="$(swift build -c "$CONFIGURATION" --show-bin-path)"
mkdir -p "$ROOT_DIR/build"
STAGING_DIR="$(mktemp -d "$ROOT_DIR/build/.staging.XXXXXX")"
APP_DIR="$STAGING_DIR/SofaPad.app"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources/Web" "$APP_DIR/Contents/Resources/Licenses"
cp "$BUILD_DIR/SofaPad" "$APP_DIR/Contents/MacOS/SofaPad"
cp MacApp/Info.plist "$APP_DIR/Contents/Info.plist"
cp Web/dist/* "$APP_DIR/Contents/Resources/Web/"
for resource in "$BUILD_DIR"/*.bundle; do
  if [ -d "$resource" ]; then cp -R "$resource" "$APP_DIR/Contents/Resources/"; fi
done
cp LICENSE "$APP_DIR/Contents/Resources/Licenses/SofaPad-MIT.txt"
for dependency in swift-nio swift-nio-ssl swift-atomics swift-collections swift-system; do
  cp ".build/checkouts/$dependency/LICENSE.txt" "$APP_DIR/Contents/Resources/Licenses/$dependency.txt"
  if [ -f ".build/checkouts/$dependency/NOTICE.txt" ]; then
    cp ".build/checkouts/$dependency/NOTICE.txt" "$APP_DIR/Contents/Resources/Licenses/$dependency-NOTICE.txt"
  fi
done
cp .build/checkouts/swift-nio/Sources/CNIOLLHTTP/LICENSE "$APP_DIR/Contents/Resources/Licenses/llhttp-MIT.txt"
# Preserve the full upstream copyright/license block; the following source section starts at FIPS.
sed -n '/SPDX-License-Identifier: BSD-3-Clause/,/^ \*\//p' .build/checkouts/swift-nio/Sources/CNIOSHA1/c_nio_sha1.c > "$APP_DIR/Contents/Resources/Licenses/WIDE-BSD-3.txt"
cp docs/licenses/BoringSSL.txt "$APP_DIR/Contents/Resources/Licenses/BoringSSL.txt"
cp docs/third-party-notices.md "$APP_DIR/Contents/Resources/Licenses/README.md"
SIGNING_IDENTITY="${SIGNING_IDENTITY:--}"
if [ "$SIGNING_IDENTITY" = "-" ]; then
  codesign --force --sign - --options runtime --timestamp=none "$APP_DIR"
else
  codesign --force --sign "$SIGNING_IDENTITY" --options runtime --timestamp "$APP_DIR"
fi
codesign --verify --deep --strict "$APP_DIR"
FINAL_APP="$ROOT_DIR/build/SofaPad.app"
if [ -e "$FINAL_APP" ]; then
  PREVIOUS_DIR="$(mktemp -d "$ROOT_DIR/build/previous.XXXXXX")"
  mv "$FINAL_APP" "$PREVIOUS_DIR/SofaPad.app"
fi
mv "$APP_DIR" "$FINAL_APP"
rmdir "$STAGING_DIR"
echo "Built: $FINAL_APP"
