# SofaPad

**Your iPhone browser. Your Mac trackpad. From the sofa.**

把 iPhone Safari 变成连接电视的 Mac 的整屏触控板和文字输入端。只安装一个 Mac 菜单栏 App，网页与服务都内置，无需手机 App 或云服务。

> 0.2.0 开发预览：已按最新 MVP 产品稿重构。开发基线统一在 [产品文档 v2.0](docs/product-blueprint.md)；自动验证与真机待测项见 [验证记录](docs/validation.md)。

- **整屏触控**：单指移动／点击／双击，双指右击／滚动，三指拖动。左上角保留悬浮手感设置，右下角切换“输入”。
- **手机输入**：原生键盘完成选词，点击“贴入输入框”发送完整文字。Mac 写入剪贴板后向当前应用执行一次 Command + V，保留手机草稿，不抢焦点、不附加回车。
- **连接**：扫码配对、单控制者、断线清理与重连、粘贴请求去重；正式使用走 HTTPS/WSS，HTTP 仅为显式开发模式。

三指系统手势、iPhone 中文输入法和电视实际操作仍需真机验收。Mac 需已登录、解锁并保持唤醒。没有屏幕镜像、远程开机／解锁、媒体键或自动查找输入框。

## 本地构建

需要 macOS、Xcode（Swift 6.2+）、Node.js 22+ 和 pnpm。当前验证环境为 Apple Silicon / macOS 26.6.2 / Xcode 26.6 / Swift 6.3.3；运行目标 macOS 13+，旧系统与 Intel 待测。

```bash
pnpm install --dir Web --frozen-lockfile
bash scripts/build.sh
open build/SofaPad.app
```

输出当前主机架构的 `build/SofaPad.app`，默认本机 ad hoc 签名；最终使用者不需要 Node。网页和依赖许可自动打包。Developer ID／公证／公开分发尚未完成。

服务首次默认关闭。在 Mac 的“首次连接与授权”选择网络地址、导入 Safari 信任且覆盖访问地址的 PEM 证书链和私钥，授予辅助功能及必要的局域网权限，然后开启服务并扫码配对。首次证书部署和开发 HTTP 用法见 [安装指南](docs/installation.md)。

## 验证与文档

```bash
bash scripts/test.sh
# 可选：安装 Playwright / Chrome 后运行桌面浏览器回归
node Tests/Integration/browser_test.mjs
```

测试使用假执行器，不操作真实鼠标或剪贴板。HTTPS 测试使用临时证书及独立信任配置，不修改系统证书信任。

- [统一产品文档](docs/product-blueprint.md)：范围、交互、边界和验收。
- [能力评估与调整](docs/decisions.md)：合并冲突及实现映射。
- [协议 v2](Protocol/README.md)：drag、paste、回执与状态约束。
- [验证记录](docs/validation.md) · [后续任务](docs/roadmap.md) · [文档索引与历史](docs/README.md)。

服务仅绑定选定以太网／Wi-Fi 的私有 IPv4，不支持公网穿透、IPv6-only 或 VPN 接口。HTTPS 信任由浏览器验证；配对不代替加密。无遥测、云服务器或自动更新。

## License

[MIT](LICENSE) · Copyright (c) 2026 Key (keyzhao0118)。[第三方许可与致谢](docs/third-party-notices.md)随 App 保留。
