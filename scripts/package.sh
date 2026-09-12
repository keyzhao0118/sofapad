#!/bin/bash
# Build local installers from the app produced by scripts/build.sh.
#   build/SofaPad-<version>.pkg  -> double-click installs into /Applications
#   build/SofaPad-<version>.dmg  -> drag SofaPad onto Applications
# Unsigned by default; set PKG_SIGNING_IDENTITY for a Developer ID Installer identity.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
APP="build/SofaPad.app"
if [ ! -d "$APP" ]; then
  echo "未找到 $APP，请先运行 bash scripts/build.sh" >&2
  exit 1
fi
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")"
PKG="build/SofaPad-$VERSION.pkg"
DMG="build/SofaPad-$VERSION.dmg"
STAGE="$(mktemp -d "$ROOT_DIR/build/.package.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

# Installer payload: the bundle keeps its signature when copied with ditto.
mkdir -p "$STAGE/payload/Applications"
ditto "$APP" "$STAGE/payload/Applications/SofaPad.app"
RAW_PKG="$STAGE/SofaPad.pkg"
pkgbuild --root "$STAGE/payload" --identifier "$IDENTIFIER" --version "$VERSION" \
  --install-location / "$RAW_PKG"

# pkgbuild marks the app bundle relocatable. macOS Installer then looks for an existing
# SofaPad.app anywhere on the volume and updates that copy instead of installing to
# /Applications — which is exactly what happens when build/SofaPad.app is lying around.
# Strip the <relocate> element so install-location and the payload decide.
EXPANDED="$STAGE/expanded"
pkgutil --expand "$RAW_PKG" "$EXPANDED"
python3 - "$EXPANDED/PackageInfo" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
patched = re.sub(r'\s*<relocate>.*?</relocate>', '', text, flags=re.S)
if patched == text:
    sys.exit('PackageInfo has no <relocate> element; packaging script needs a look')
path.write_text(patched, encoding='utf-8')
PY
rm -f "$PKG"
pkgutil --flatten "$EXPANDED" "$PKG"
if [ -n "${PKG_SIGNING_IDENTITY:-}" ]; then
  productsign --sign "$PKG_SIGNING_IDENTITY" "$PKG" "$STAGE/signed.pkg"
  mv "$STAGE/signed.pkg" "$PKG"
fi
echo "Built: $PKG"

if [ "${MAKE_ZIP:-1}" = "1" ]; then
  ZIP="build/SofaPad-$VERSION-macos-${ARCH:-arm64}.zip"
  rm -f "$ZIP"
  ditto -c -k --keepParent "$APP" "$ZIP"
  echo "Built: $ZIP"
fi

if [ "${MAKE_DMG:-1}" = "1" ]; then
  mkdir -p "$STAGE/dmg"
  ditto "$APP" "$STAGE/dmg/SofaPad.app"
  ln -s /Applications "$STAGE/dmg/Applications"
  rm -f "$DMG"
  # The package above is the primary artifact; a DMG is a convenience for drag-install.
  if hdiutil create -volname "SofaPad $VERSION" -srcfolder "$STAGE/dmg" -format UDZO "$DMG" >/dev/null 2>&1; then
    echo "Built: $DMG"
  else
    echo "提示：DMG 创建失败（例如在没有磁盘映像权限的环境），已生成的 .pkg 可直接使用；可用 MAKE_DMG=0 跳过。" >&2
  fi
fi
