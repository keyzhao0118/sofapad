# SofaPad

**用手机控制 Windows 和 Mac。手机是触控板，也是键盘。**

坐在沙发上，用手机移动指针、点击、滚动、拖动，再用熟悉的中文输入法搜索。电脑安装 SofaPad，手机打开浏览器，连接同一个家庭 Wi-Fi 即可。**手机无需安装 App，无需账号，无需编写命令。**

[产品介绍与安装引导](https://keyzhao0118.github.io/sofapad/) · [0.10.0 发布页面](https://github.com/keyzhao0118/sofapad/releases/tag/v0.10.0) · [完整使用教程](docs/installation.md)

## 下载到你的电脑

| 你的电脑 | 推荐下载 | 备用方式 |
| --- | --- | --- |
| **Windows 11 · x64（Intel / AMD）** | **[Windows 安装包 EXE](https://github.com/keyzhao0118/sofapad/releases/download/v0.10.0/SofaPad-0.10.0-windows-x64-setup.exe)** | [便携 ZIP](https://github.com/keyzhao0118/sofapad/releases/download/v0.10.0/SofaPad-0.10.0-windows-x64.zip) |
| **Mac · macOS 13+ · Apple Silicon（M 系列）** | **[Mac 安装包 PKG](https://github.com/keyzhao0118/sofapad/releases/download/v0.10.0/SofaPad-0.10.0-macos-arm64.pkg)** | [App ZIP](https://github.com/keyzhao0118/sofapad/releases/download/v0.10.0/SofaPad-0.10.0-macos-arm64.zip) |

当前版本 **0.10.0 · 开发预览**。[全部文件与发布说明](https://github.com/keyzhao0118/sofapad/releases/tag/v0.10.0) · [SHA-256 校验值](https://github.com/keyzhao0118/sofapad/releases/download/v0.10.0/SofaPad-0.10.0-SHA256SUMS.txt)。

安装包包含运行所需内容，不需要另装 .NET、Node.js 或 Python。GitHub 的 **Source code** 是源码，普通用户下载上表的 EXE 或 PKG 即可。Mac Intel 需自行构建；Windows 10 / ARM64 尚未验证。

Windows 包未代码签名，Mac 包未公证，首次安装可能出现系统提示；处理方法见[首次安装提示](docs/installation.md#首次安装提示)。

## 第一次使用

**Windows**

1. 双击 EXE，按向导安装，从开始菜单打开 SofaPad。
2. 在右下角通知区域找到图标，可能藏在 **∧** 里；双击查看连接地址。没有主窗口是正常的。
3. 手机和电脑连同一个家庭 Wi-Fi，并将 Windows 的当前网络设为**专用网络**。

**Mac**

1. 双击 PKG 安装，再从“应用程序”打开 SofaPad；图标在屏幕顶部菜单栏。
2. 点击菜单中的“授予辅助功能权限…”，在系统设置里开启 SofaPad。
3. 手机和 Mac 连同一个家庭 Wi-Fi，查看菜单显示的 IP 或 .local 地址。

**最后，在手机浏览器打开电脑显示的地址**，例如 `http://192.168.1.23:9876/`。这只是例子，请使用你自己电脑上的地址，并保留 `http://` 和 `:9876`。看到触控板后滑动一下，电脑指针跟着移动就成功了。

[Windows 详细教程](docs/windows-installation.md) · [Mac 详细教程](docs/macos-installation.md) · [连接不上？](docs/installation.md#连接不上时逐项检查)

> 本仓库的 GitHub Pages 是介绍与下载页。真正的控制页面由你电脑上的 SofaPad 提供；使用时请打开电脑显示的局域网地址。

![Windows 与 Mac 共用的手机触控板](docs/images/phone-trackpad.png)

## 两个平台，一套操作

| 手机上的操作 | 电脑上的效果 |
| --- | --- |
| 单指滑动 / 轻点 / 双击 | 移动指针 / 左击 / 双击 |
| 双指轻点，或长按约半秒 | 右击 |
| 双指滑动 / 左右边缘单指滑动 | 双轴滚动 / 纵向滚动 |
| 三指滑动，或轻点后再按住稍停并滑动 | 拖动窗口、进度条或选区 |
| 右上角打开键盘 | 中文、英文、Emoji、退格与 Enter，发到电脑当前焦点 |
| 左上角打开设置 | 指针速度、滚动速度、自然滚动、手机常亮 |

先点中电脑输入框，再用手机打字；回车是否提交由目标应用决定。设置保存在当前电脑，多部手机同步。两端支持开关服务、断开设备与登录启动。完整手势、听写和常亮说明见[使用教程](docs/installation.md)。

## 使用范围与验证

- 电脑保持已登录、解锁和唤醒。Windows 管理员窗口、UAC 安全桌面和锁屏不受控。
- 只用于可信家庭局域网：无账号或配对，打开地址即可控制，使用明文 HTTP/WS；不要映射到公网。
- 没有屏幕镜像、远程开机、解锁、云端中转或自动更新。
- Windows 的 **177 项自动测试**、浏览器回归、隔离窗口真实输入及隔离系统安装/升级/卸载通过；macOS 测试与 App 构建通过。手机 Wi-Fi 实连、混合 DPI 多屏、长时间使用和实际登录启动仍待真机验收。[Windows 验证记录](docs/windows-validation.md) · [Mac 验证记录](docs/validation.md)。

## 开发者入口

普通用户无需执行以下命令；直接下载上面的安装包即可。

Windows 需要 .NET SDK 10.0.402、Node.js 22+、pnpm 和 Python；打包另需 Inno Setup 6。

```powershell
./scripts/build-windows.ps1
./scripts/test-windows.ps1
./scripts/package-windows.ps1
```

macOS 需要 Xcode（Swift 6.2+）、Node.js 22+ 和 pnpm。

```bash
pnpm --dir Web install --frozen-lockfile
bash scripts/test.sh
bash scripts/build.sh
MAKE_DMG=0 bash scripts/package.sh
```

[产品与架构文档](docs/README.md) · [协议 v2](Protocol/README.md) · [Windows 移植设计基线](docs/windows-porting.md) · [双平台发布流程](docs/releasing.md) · [更新记录](CHANGELOG.md) · [反馈问题](https://github.com/keyzhao0118/sofapad/issues)

[MIT](LICENSE) · © 2026 Key（keyzhao0118）· [第三方许可](docs/third-party-notices.md)
