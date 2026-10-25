# 双平台发布与 GitHub Pages 维护

当前公开版本：**0.10.0 · Windows / Mac 开发预览**，标签 `v0.10.0`。历史版本保留。

- [产品介绍与安装引导](https://keyzhao0118.github.io/sofapad/)
- [0.10.0 Release](https://github.com/keyzhao0118/sofapad/releases/tag/v0.10.0)
- [发布说明原文](releases/0.10.0.md)

## 发布入口

版本标签触发 [.github/workflows/release.yml](../.github/workflows/release.yml)，复用双平台 CI：

1. Windows 构建、测试、浏览器回归、生成 EXE / ZIP，并在隔离 runner 上验证安装、升级和卸载。
2. macOS 构建、测试、生成 Apple Silicon PKG / ZIP，验证 PKG 的 /Applications 安装位置、ZIP 内容、版本、架构和每个 App 文件。
3. 两个平台全部成功后，汇总四个安装文件并生成统一 SHA-256 文件。
4. 在 GitHub 创建草稿，上传文件并逐项比对服务器返回的大小和 SHA-256；全部一致后公开发布并设为最新。失败时保留草稿，不发布不完整的下载入口。

Release 使用 GitHub Actions 的仓库令牌；不需要在电脑保存发布令牌。公开版本的安装包不会自动覆盖。

## 发布前检查

更新版本时同时检查：

- `Web/package.json`、`MacApp/Info.plist`（含构建号）、`WindowsApp/Directory.Build.props`；
- Windows 构建、安装和测试脚本中的默认版本；
- README、CHANGELOG、`docs/index.html`、三份安装教程，以及 `docs/releases/<版本>.md`；
- 官网、README 和 Release 的四个下载文件名必须一致。

可以在 PR 上先跑双平台 CI；两端安装包会作为 `SofaPad-windows-x64`、`SofaPad-macos-arm64` artifacts 留存。Artifacts 面向开发者且会过期；对外下载入口必须指向 Release 附件。

正常发布：先提交并合入 main，再运行：

```bash
bash scripts/publish-release.sh --dry-run
bash scripts/publish-release.sh
```

也可以推送已核对的标签，例如：

```bash
git tag -a v0.10.0 -m "SofaPad 0.10.0 - Windows / Mac"
git push origin v0.10.0
```

已有公开标签不得移动或重写。构建失败时修正问题并按实际情况发布新版本；仅临时网络失败可在 Actions 重跑原工作流。

## 对外文件

| 文件 | 用途 |
| --- | --- |
| `SofaPad-0.10.0-windows-x64-setup.exe` | Windows 推荐安装器 |
| `SofaPad-0.10.0-windows-x64.zip` | Windows 便携版 |
| `SofaPad-0.10.0-macos-arm64.pkg` | Mac 推荐安装器 |
| `SofaPad-0.10.0-macos-arm64.zip` | Mac App ZIP |
| `SofaPad-0.10.0-SHA256SUMS.txt` | 四个文件的统一 SHA-256 |

安装包不提交到 Git。Windows 自带运行时；Mac 仍为 ad hoc 签名，没有 Developer ID、公证；Windows 未 Authenticode 签名。发布页与安装步骤应如实说明，不能称为已签名稳定版。

## GitHub Pages

仓库 Settings → Pages 使用 **Deploy from a branch**，来源 **main /docs**。保留 `docs/.nojekyll`。

- `docs/index.html`：双平台首屏下载、安装引导、手势、FAQ 和下载卡片。
- `docs/site.css`：响应式布局，沿用现有品牌颜色与图标。
- `docs/site.js`：Windows / Mac 引导切换、深链接及安装提示展开。没有 JavaScript 时两份指南仍可阅读。
- `docs/demo.js`：手机与电脑同步操作的模拟动画，不会投递真实输入。
- `docs/installation.md`：通用快速开始；Windows 与 Mac 分别有详细教程。

先确认 Release 的下载文件存在，再上线对应版本的页面按钮。发布后检查：主页和资源 HTTP 200，所有下载链接可到达附件，手机和桌面布局正常，系统切换与锚点可用。源码推送到 main 后由 GitHub Pages 自动部署。

本地页面回归：

```text
node Tests/Integration/site_test.mjs
```

使用与原浏览器回归相同的 `PLAYWRIGHT_MODULE`、`CHROME_BINARY` 环境变量。检查会启动临时回环服务器，覆盖窄屏、桌面、系统切换、深链接和无 JavaScript 阅读，不控制真实电脑输入。

## 面向用户的说明原则

首先说明 Windows / Mac 共用手机界面，给出对应安装包和实际支持的系统/架构。安装步骤按系统区分，解释没有主窗口、图标在哪里、Mac 授权及 Windows 专用网络。

明确区分介绍网站与真正的局域网控制地址；不要让普通用户下载 Source code、安装开发环境或运行构建脚本。对未签名、公证及尚未完成的手机真机验收保持准确说明。
