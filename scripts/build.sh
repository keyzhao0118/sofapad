#!/bin/bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
NODE_BINARY="${NODE_BINARY:-node}"
PNPM_BINARY="${PNPM_BINARY:-pnpm}"
CONFIGURATION="${CONFIGURATION:-release}"
# Restricted or nested sandboxes may need SWIFT_BUILD_FLAGS=--disable-sandbox.
SWIFT_BUILD_FLAGS="${SWIFT_BUILD_FLAGS:-}"
if [ ! -f Web/node_modules/typescript/bin/tsc ]; then
  "$PNPM_BINARY" install --dir Web --frozen-lockfile
fi
"$NODE_BINARY" Web/node_modules/typescript/bin/tsc -p Web/tsconfig.json
(cd Web && "$NODE_BINARY" build.mjs)
# Unquoted on purpose: an empty value must expand to no argument.
# shellcheck disable=SC2086
swift build $SWIFT_BUILD_FLAGS -c "$CONFIGURATION" --force-resolved-versions --cache-path .build/cache --config-path .build/config --security-path .build/security
BUILD_DIR="$(swift build $SWIFT_BUILD_FLAGS -c "$CONFIGURATION" --show-bin-path)"
mkdir -p "$ROOT_DIR/build"
# Keep build artifacts (including the previous.* backups) out of Spotlight results.
touch "$ROOT_DIR/build/.metadata_never_index"
STAGING_DIR="$(mktemp -d "$ROOT_DIR/build/.staging.XXXXXX")"
APP_DIR="$STAGING_DIR/SofaPad.app"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources/Web" "$APP_DIR/Contents/Resources/Licenses"
cp "$BUILD_DIR/SofaPad" "$APP_DIR/Contents/MacOS/SofaPad"
cp MacApp/Info.plist "$APP_DIR/Contents/Info.plist"
cp MacApp/AppIcon.icns "$APP_DIR/Contents/Resources/AppIcon.icns"
cp Web/dist/* "$APP_DIR/Contents/Resources/Web/"
# Only current dependencies may ship: .build can still hold bundles of removed packages
# (for example swift-nio-ssl) and they would otherwise be copied into the app.
DEPENDENCIES="swift-nio swift-atomics swift-collections swift-system"
for resource in "$BUILD_DIR"/*.bundle; do
  [ -d "$resource" ] || continue
  name="$(basename "$resource")"
  keep=false
  for dependency in $DEPENDENCIES; do
    case "$name" in "$dependency"_*) keep=true ;; esac
  done
  if [ "$keep" = true ]; then
    cp -R "$resource" "$APP_DIR/Contents/Resources/"
  else
    echo "跳过不属于当前依赖的资源包：$name" >&2
  fi
done
cp LICENSE "$APP_DIR/Contents/Resources/Licenses/SofaPad-MIT.txt"
for dependency in $DEPENDENCIES; do
  cp ".build/checkouts/$dependency/LICENSE.txt" "$APP_DIR/Contents/Resources/Licenses/$dependency.txt"
  if [ -f ".build/checkouts/$dependency/NOTICE.txt" ]; then
    cp ".build/checkouts/$dependency/NOTICE.txt" "$APP_DIR/Contents/Resources/Licenses/$dependency-NOTICE.txt"
  fi
done
cp .build/checkouts/swift-nio/Sources/CNIOLLHTTP/LICENSE "$APP_DIR/Contents/Resources/Licenses/llhttp-MIT.txt"
# Preserve the full upstream copyright/license block; the following source section starts at FIPS.
sed -n '/SPDX-License-Identifier: BSD-3-Clause/,/^ \*\//p' .build/checkouts/swift-nio/Sources/CNIOSHA1/c_nio_sha1.c > "$APP_DIR/Contents/Resources/Licenses/WIDE-BSD-3.txt"
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
  if ! mv "$FINAL_APP" "$PREVIOUS_DIR/SofaPad.app"; then
    echo "无法替换 $FINAL_APP：它可能属于其他用户（例如曾在外层沙箱里构建）。请先删除它再重试。" >&2
    exit 1
  fi
fi
mv "$APP_DIR" "$FINAL_APP"
rmdir "$STAGING_DIR"
echo "Built: $FINAL_APP"
