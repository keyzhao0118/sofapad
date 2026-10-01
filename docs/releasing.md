# GitHub 发布与 Pages 维护

当前版本 **0.9.10（构建 21）**，标签 `v0.9.10`。此前 GitHub 已有 0.9.7 Release，保留历史，新版设为最新。

- [中文宣传与使用页](https://keyzhao0118.github.io/sofapad/)
- [0.9.10 Release](https://github.com/keyzhao0118/sofapad/releases/tag/v0.9.10)
- [发布说明原文](releases/0.9.10.md)

## 发布前

1. 更新 `MacApp/Info.plist` 与 `Web/package.json` 的版本，以及 README、CHANGELOG、宣传页、安装教程和验证记录。
2. 运行 `bash scripts/test.sh`。有键盘或手势改动时运行 `Tests/Integration/browser_test.mjs`，浏览器演示只使用假输入后端。
3. 构建与打包：`bash scripts/build.sh`，再 `MAKE_DMG=0 bash scripts/package.sh`。
4. 解包核对安装位置、版本、App 文件哈希和内置 Web 资源，运行 `codesign --verify --deep --strict build/SofaPad.app`。本机 ad hoc 校验不代表 Developer ID 签名、公证或真机验收。
5. 为 `.pkg` 与 `.zip` 生成校验文件；文件名必须与 Release 一致：

```bash
(cd build && shasum -a 256 SofaPad-0.9.10.pkg SofaPad-0.9.10-macos-arm64.zip) > build/SofaPad-0.9.10-SHA256SUMS.txt
```

6. 提交所有源码与文档；安装包不进入 Git，作为 Release 附件上传。确认远端没有新提交，不强推。

## 发布 Release

网页方式：在 Releases 创建草稿，选择 `v0.9.10` 标签并指向包含本版源码的提交；填写 [发布说明](releases/0.9.10.md)，上传 `.pkg`、`.zip` 和 `SHA256SUMS.txt`，等三个文件全部上传完成后发布，设为最新。旧 Release 和标签保留。

脚本方式：`bash scripts/publish-release.sh`。需要已有 Git 推送认证，以及可访问本仓库的 GitHub 令牌：Contents 读写用于 Release，Pages 读写用于配置介绍页。令牌通过隐藏输入或 `GH_TOKEN` 环境变量传入，不提交到仓库。可用 `PYTHON_BINARY` 指定运行时。

脚本会拒绝未提交改动、分支／App 版本不一致或缺失产物；先创建草稿，上传三份附件后再发布。同名已有资源须通过大小与 SHA-256 比对，不覆盖不一致的安装包。发布说明优先读取 `docs/releases/<版本>.md`，不存在则使用 CHANGELOG 中的对应段落。

## GitHub Pages

仓库 Settings → Pages → Build and deployment：选择 **Deploy from a branch**，分支 **main**，目录 **/docs**。`docs/.nojekyll` 保留，入口为 `docs/index.html`，样式为 `docs/site.css`，同步演示为 `docs/demo.js`（本地 ES module），图标和截图在 `docs/images/`。

宣传页以中文为主，首屏用六段手机／Mac 同步动画展示移动点击、边缘滚动、拖动、中文输入、双击与长按右击。演示为单张卡片加底部一句说明，自动轮流播放，无控制栏和步骤文字；完整手势、输入与设置收进可展开指南，安装和 FAQ 保留。它是介绍与下载页，不提供遥控连接；用户仍需打开自己 Mac 菜单里的局域网地址。无第三方字体、追踪脚本或框架依赖。演示维护方式见 [动态宣传页](promotion-demo.md)。

发布后检查 Pages 部署成功、页面 HTTP 200、图像与样式正常、PKG／ZIP 下载链接指向最新版本。源码更新推到 main 后，Pages 自动部署。下一版需同步更改首页两处下载链接、版本显示、README 与安装教程。

截图使用实际浏览器演示后端生成，说明中标注未展示原生手机键盘；不要把桌面模拟截图当成 iPhone 真机验收。

## 公开分发的边界

当前提供 Apple Silicon 开发预览，未经过 Apple 公证。Developer ID、Hardened Runtime、公证、旧版 macOS 和真实 iPhone 验收仍是后续工作。服务无配对、明文 HTTP/WS，只供可信家庭局域网使用。发布说明和宣传页必须保留这些实际限制。
