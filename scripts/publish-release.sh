#!/bin/bash
# 发布一个版本：推送代码与标签、创建 GitHub Release 并上传安装包、开启 GitHub Pages。
#
#   bash scripts/publish-release.sh              # 版本号取 MacApp/Info.plist，令牌交互式输入
#   GH_TOKEN=xxx bash scripts/publish-release.sh 0.9.10
#   bash scripts/publish-release.sh --dry-run    # 只打印将要执行的操作
#
# 只需要一个 GitHub 令牌：classic 勾 repo，或 fine-grained 只授权本仓库的
# Contents: Read and write（推送与 Release）。开启 Pages 还需要 Pages: Read and write。
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

REPO_SLUG="${REPO_SLUG:-keyzhao0118/sofapad}"
GIT_REMOTE="${GIT_REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
PAGES_PATH="${PAGES_PATH:-/docs}"
API="https://api.github.com"
UPLOADS="https://uploads.github.com"
DRY_RUN=""
VERSION=""
for argument in "$@"; do
  case "$argument" in
    --dry-run) DRY_RUN=1 ;;
    -*) echo "未知参数：$argument" >&2; exit 2 ;;
    *) VERSION="$argument" ;;
  esac
done
VERSION="${VERSION:-$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' MacApp/Info.plist)}"
TAG="v$VERSION"
APP="build/SofaPad.app"
PYTHON_BINARY="${PYTHON_BINARY:-python3}"

echo "仓库：$REPO_SLUG    版本：$VERSION    标签：$TAG"
[ -d "$APP" ] || { echo "找不到 ${APP}，请先运行 bash scripts/build.sh 与 bash scripts/publish-release.sh 之前的打包步骤" >&2; exit 1; }

# Validate before pushing a tag or creating a release.
[ -z "$(git status --porcelain)" ] || { echo "先提交工作区改动再发布，避免标签与安装包源码不一致。" >&2; exit 1; }
[ "$(git branch --show-current)" = "$BRANCH" ] || { echo "请先切换到 $BRANCH 分支。" >&2; exit 1; }
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' MacApp/Info.plist)" = "$VERSION" ] || { echo "源码版本与发布版本不一致。" >&2; exit 1; }
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")" = "$VERSION" ] || { echo "App 版本与发布版本不一致，请重新构建。" >&2; exit 1; }
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Contents/Info.plist")" = "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' MacApp/Info.plist)" ] || { echo "App 构建号与源码不一致，请重新构建。" >&2; exit 1; }
for asset in "build/SofaPad-$VERSION.pkg" "build/SofaPad-$VERSION-macos-arm64.zip"; do
  [ -f "$asset" ] || { echo "缺少 $asset，请先打包。" >&2; exit 1; }
done
CHECKSUMS="build/SofaPad-$VERSION-SHA256SUMS.txt"
(cd build && shasum -a 256 "SofaPad-$VERSION.pkg" "SofaPad-$VERSION-macos-arm64.zip") > "$CHECKSUMS"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

# 1. 令牌
if [ -z "${GH_TOKEN:-}" ]; then
  if [ -n "$DRY_RUN" ]; then GH_TOKEN="dry-run"; else
    read -rs -p "GitHub 令牌（输入时不显示）：" GH_TOKEN; echo
  fi
fi
if [ "$DRY_RUN" ]; then
  LOGIN="<dry-run>"
else
  LOGIN="$(curl -fsS -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" "$API/user" \
    | "$PYTHON_BINARY" -c 'import json,sys; print(json.load(sys.stdin)["login"])')" \
    || { echo "令牌无效或权限不足（需要 repo，或 fine-grained 的 Contents/Pages 写权限）" >&2; exit 1; }
fi
echo "已认证：$LOGIN"

# 2. 发布说明：取 CHANGELOG 里该版本的段落
NOTES="$TEMP_DIR/notes.md"
"$PYTHON_BINARY" - "$VERSION" >"$NOTES" <<'PY'
import pathlib, re, sys
version = sys.argv[1]
release_notes = pathlib.Path(f'docs/releases/{version}.md')
if release_notes.exists():
    print(release_notes.read_text(encoding='utf-8'))
    raise SystemExit
text = pathlib.Path('CHANGELOG.md').read_text(encoding='utf-8')
match = re.search(rf'^## {re.escape(version)} — .*$', text, re.M)
if not match:
    raise SystemExit(f'Missing CHANGELOG entry for {version}')
rest = text[match.end():]
end = re.search(r'^## ', rest, re.M)
print(rest[:end.start()].strip() if end else rest.strip())
PY
echo "发布说明：${NOTES}（$(wc -l <"$NOTES" | tr -d ' ') 行）"

# 3. 推送分支与标签
if [ -n "$DRY_RUN" ]; then
  echo "[dry-run] git push $GIT_REMOTE $BRANCH && git push $GIT_REMOTE $TAG"
else
  if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    [ "$(git rev-list -n 1 "$TAG")" = "$(git rev-parse HEAD)" ] || { echo "已存在的标签指向另一提交，停止发布。" >&2; exit 1; }
  fi
  git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || git tag -a "$TAG" -m "SofaPad $VERSION"
  git push "$GIT_REMOTE" "$BRANCH"
  git push "$GIT_REMOTE" "$TAG"
fi

# 4. 创建 Release（已存在则复用）
RELEASE_JSON="$TEMP_DIR/release.json"
if [ -n "$DRY_RUN" ]; then
  echo "[dry-run] POST $API/repos/$REPO_SLUG/releases（tag ${TAG}）"
  RELEASE_ID="<dry-run>"
else
  BODY="$("$PYTHON_BINARY" - "$TAG" "$VERSION" "$NOTES" <<'PY'
import json, sys
tag, version, notes = sys.argv[1], sys.argv[2], sys.argv[3]
print(json.dumps({"tag_name": tag, "name": f"SofaPad {version}", "body": open(notes, encoding="utf-8").read(), "draft": True, "prerelease": False}))
PY
)"
  CODE="$(curl -sS -o "$RELEASE_JSON" -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
    "$API/repos/$REPO_SLUG/releases" -d "$BODY")"
  if [ "$CODE" = "201" ]; then
    RELEASE_ID="$("$PYTHON_BINARY" -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$RELEASE_JSON")"
    echo "已创建 Release（id ${RELEASE_ID}）"
  elif [ "$CODE" = "422" ]; then
    curl -fsS -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
      "$API/repos/$REPO_SLUG/releases/tags/$TAG" -o "$RELEASE_JSON"
    RELEASE_ID="$("$PYTHON_BINARY" -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$RELEASE_JSON")"
    echo "Release 已存在，复用（id ${RELEASE_ID}）"
  else
    echo "创建 Release 失败：HTTP $CODE" >&2; cat "$RELEASE_JSON" >&2; exit 1
  fi
fi

# 5. 上传安装包（同名资源已存在则跳过）
EXISTING="$TEMP_DIR/assets.json"
if [ -n "$DRY_RUN" ]; then
  for asset in "build/SofaPad-$VERSION.pkg" "build/SofaPad-$VERSION-macos-arm64.zip" "$CHECKSUMS"; do
    echo "[dry-run] POST $UPLOADS/repos/$REPO_SLUG/releases/<id>/assets?name=$(basename "$asset")"
  done
else
  curl -fsS -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
    "$API/repos/$REPO_SLUG/releases/$RELEASE_ID/assets" -o "$EXISTING"
  for asset in "build/SofaPad-$VERSION.pkg" "build/SofaPad-$VERSION-macos-arm64.zip" "$CHECKSUMS"; do
    [ -f "$asset" ] || { echo "缺少 ${asset}，先运行 bash scripts/package.sh" >&2; exit 1; }
    name="$(basename "$asset")"
    if "$PYTHON_BINARY" -c 'import json,sys; sys.exit(0 if any(a["name"]==sys.argv[2] for a in json.load(open(sys.argv[1]))) else 1)' "$EXISTING" "$name"; then
      "$PYTHON_BINARY" - "$EXISTING" "$asset" <<'PY'
import hashlib, json, pathlib, sys
path = pathlib.Path(sys.argv[2])
asset = next(a for a in json.load(open(sys.argv[1])) if a['name'] == path.name)
digest = 'sha256:' + hashlib.sha256(path.read_bytes()).hexdigest()
if asset.get('size') != path.stat().st_size or asset.get('digest') != digest:
    raise SystemExit('Existing release asset does not match local SHA-256; refusing to skip or overwrite')
PY
      echo "已存在，跳过：$name"; continue
    fi
    echo "上传 ${name}（$(du -h "$asset" | cut -f1)）"
    curl -fsS -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
      -H "Content-Type: application/octet-stream" \
      "$UPLOADS/repos/$REPO_SLUG/releases/$RELEASE_ID/assets?name=$name" --data-binary @"$asset" >/dev/null
  done
fi

# Publish only after all three assets have uploaded successfully.
if [ -n "$DRY_RUN" ]; then
  echo "[dry-run] PATCH $API/repos/$REPO_SLUG/releases/<id>（发布并设为最新）"
else
  curl -fsS -X PATCH -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
    "$API/repos/$REPO_SLUG/releases/$RELEASE_ID" -d '{"draft":false,"make_latest":"true"}' >/dev/null
fi

# 6. 开启 GitHub Pages（源：主分支 /docs），已开启则更新源
PAGES_JSON="$TEMP_DIR/pages.json"
PAGES_BODY='{"source":{"branch":"'"$BRANCH"'","path":"'"$PAGES_PATH"'"}}'
if [ -n "$DRY_RUN" ]; then
  echo "[dry-run] POST $API/repos/$REPO_SLUG/pages $PAGES_BODY"
  PAGES_URL="https://<owner>.github.io/<repo>/"
else
  CODE="$(curl -sS -o "$PAGES_JSON" -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
    "$API/repos/$REPO_SLUG/pages" -d "$PAGES_BODY")"
  if [ "$CODE" = "409" ] || [ "$CODE" = "422" ]; then
    echo "Pages 已开启，更新来源为 $BRANCH$PAGES_PATH"
    CODE="$(curl -sS -o "$PAGES_JSON" -w '%{http_code}' -X PUT \
      -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
      "$API/repos/$REPO_SLUG/pages" -d "$PAGES_BODY")"
  fi
  case "$CODE" in 200|201|204) ;; *) echo "开启 Pages 失败：HTTP $CODE" >&2; cat "$PAGES_JSON" >&2; exit 1 ;; esac
  PAGES_URL="$("$PYTHON_BINARY" -c 'import json,pathlib,sys; s=pathlib.Path(sys.argv[1]).read_text(); d=json.loads(s) if s.strip() else {}; print(d.get("html_url") or "")' "$PAGES_JSON")"
fi

echo
echo "完成："
echo "  Release：https://github.com/$REPO_SLUG/releases/tag/$TAG"
echo "  介绍页：${PAGES_URL:-https://github.com/$REPO_SLUG/settings/pages}"
echo "Pages 首次部署通常需要 1–2 分钟，之后 https://<owner>.github.io/<repo>/ 即可访问。"
