#!/bin/bash
# Publish a tested Windows + Mac release using GitHub Actions.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
VERSION=""
DRY_RUN=""
for argument in "$@"; do
  case "$argument" in
    --dry-run) DRY_RUN=1 ;;
    -*) echo "Unknown option: $argument" >&2; exit 2 ;;
    *) VERSION="$argument" ;;
  esac
done
PYTHON_BINARY="${PYTHON_BINARY:-python3}"
SOURCE_VERSION="$("$PYTHON_BINARY" -c 'import json; print(json.load(open("Web/package.json"))["version"])')"
VERSION="${VERSION:-$SOURCE_VERSION}"
[ "$VERSION" = "$SOURCE_VERSION" ] || { echo 'Version differs from source' >&2; exit 1; }
TAG="v$VERSION"
[ -f "docs/releases/$VERSION.md" ] || { echo 'Release notes are missing' >&2; exit 1; }
if [ -n "$DRY_RUN" ]; then
  echo "[dry-run] Verify clean main synchronized with origin/main, then create and push $TAG."
  echo '[dry-run] GitHub Actions builds and validates both platforms, uploads a draft, then publishes all downloads together.'
  exit 0
fi
[ -z "$(git status --porcelain)" ] || { echo 'Commit local changes first' >&2; exit 1; }
[ "$(git branch --show-current)" = main ] || { echo 'Switch to main before publishing' >&2; exit 1; }
git fetch origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo 'Local main must match origin/main' >&2; exit 1; }
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo 'Tag already exists; do not move a published tag. Inspect its existing workflow run.' >&2
  exit 1
fi
[ -z "$(git ls-remote --tags origin "refs/tags/$TAG")" ] || { echo 'Tag already exists on GitHub' >&2; exit 1; }
git tag -a "$TAG" -m "SofaPad $VERSION - Windows / Mac"
git push origin "refs/tags/$TAG"
echo "Follow the publishing run: https://github.com/keyzhao0118/sofapad/actions/workflows/release.yml"
