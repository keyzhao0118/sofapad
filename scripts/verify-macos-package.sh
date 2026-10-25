#!/bin/bash
# Inspect the installer payload and ZIP without installing on the runner.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' MacApp/Info.plist)"
APP="build/SofaPad.app"
test "$(lipo -archs "$APP/Contents/MacOS/SofaPad")" = arm64
SCRATCH="$(mktemp -d "$ROOT_DIR/build/.verify-package.XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT
pkgutil --expand-full "build/SofaPad-$VERSION.pkg" "$SCRATCH/pkg"
ditto -x -k "build/SofaPad-$VERSION-macos-arm64.zip" "$SCRATCH/zip"
python3 - "$APP" "$SCRATCH" "$VERSION" <<'PY'
from pathlib import Path
import hashlib, plistlib, sys
source, scratch, version = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
def files(path):
    return {str(p.relative_to(path)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in path.rglob('*') if p.is_file()}
expected = files(source)
for candidate in (scratch / 'pkg/Payload/Applications/SofaPad.app', scratch / 'zip/SofaPad.app'):
    assert candidate.is_dir(), f'Missing application: {candidate}'
    assert files(candidate) == expected, f'Package contents differ: {candidate}'
    with (candidate / 'Contents/Info.plist').open('rb') as stream:
        assert plistlib.load(stream)['CFBundleShortVersionString'] == version
print('PASS: arm64 architecture, PKG /Applications payload, ZIP, versions and every bundled file')
PY
codesign --verify --deep --strict "$SCRATCH/pkg/Payload/Applications/SofaPad.app"
codesign --verify --deep --strict "$SCRATCH/zip/SofaPad.app"
