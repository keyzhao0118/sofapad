# Windows 验证记录 — 0.10.0

日期：2026-10-25。源码起点 `f19d4b593212fe61fae9f1b43756a853b399a855`，对应原 Windows 移植交接。

环境：Windows 11 家庭版中文版 x64（10.0.26300）、.NET SDK 10.0.402、.NET 10.0.13、Node.js、Python 3.9、桌面 Chrome。发布为 win-x64 自包含，不裁剪。安装器为 Inno Setup 6。

## 自动化证据

| 检查 | 结果 |
| --- | --- |
| Windows Release 构建 | 通过，0 警告、0 错误 |
| 共用网页单元测试 | 95 项通过；含原有手势、IME、常亮、键盘和新增平台提示/保存错误 |
| C# 核心/输入后端/退出协调 | 66 项通过；含全部 52 组共享协议样例，以及安装器等待退出和超时检查 |
| HTTP/WS 回环集成 | 16 项通过；静态资源、Host/Origin、并发会话、分片、去重、超时、掩码及线上协议样例 |
| Chromium 手机视口回归 | 通过；20 轮刷新、两控制器、顶部键盘、IME、拖动、边缘滚动、设置与横屏 |
| 发布资源 | 构建脚本逐个校验 Web/dist 与发布目录的 SHA-256；携带运行时、许可和使用说明 |
| 自包含程序 | 将 DOTNET_ROOT 指向不存在的运行时目录，直接执行发布的 SofaPad.exe；16 项 HTTP/WS 集成测试仍全部通过 |
| Windows 安装生命周期 | 隔离的 GitHub Windows runner 安装、校验防火墙作用域、运行已安装程序、覆盖升级、保留设置、清理过期 Web 模块、卸载和移除防火墙规则均通过 |
| macOS 兼容性 | macOS CI 的共享网页、Swift、HTTP/WS 测试和 Mac App 构建及资源校验均通过 |

核心测试专门覆盖了小数累积、第二次点击不变成第三次、细粒度双轴滚轮、多手机争用、UTF-8 长度、64 位序号、设置写失败、损坏恢复、粘贴去重容量、Win32 INPUT x64 布局、Unicode 代理对、SendInput 部分投递清理、虚拟桌面负坐标与屏幕空隙。

CI 证据见 [Windows / macOS 双平台验证](https://github.com/keyzhao0118/sofapad/actions/runs/40089995608)。安装测试脚本 `scripts/test-windows-installer.ps1` 仅允许在一次性的 GitHub runner 执行，不会在开发者电脑覆盖已有安装。升级、卸载的退出命令会等待托盘释放实例锁；超时返回错误，升级器停止覆盖，避免仍在清理输入时替换文件。

## 真实桌面验证状态

原生输入验证程序位于 `WindowsApp/tests/SofaPad.DesktopProbe`。首次自动启动验证时用户同时操作电脑，测试编辑框未收到预期文本；用户确认停止自己的操作后，增加前台窗口归属检查并重新运行，**全部真实输入验证通过**：

- 普通 Windows 编辑框接收中文、Emoji、组合字符，原始文本逐字一致。
- edit 删除后插入、Backspace、真正的 Enter、Ctrl+V 与回执。
- 指针精确物理像素定位、两次点击形成一次双击而没有第三次、右击。
- 细粒度双轴滚轮增量（纵向 -12、横向 -10）实际到达测试控件。
- 真实拖动按住后断开 WebSocket，测试控件收到左键释放。

这使用真实 Win32 SendInput 和真实 HTTP/WebSocket 链路，输入目标为隔离的 WinForms 测试窗口；不代表已经验证所有第三方应用和手机系统。测试会先检查自身窗口确实位于前台，避免把生成文字送到其他应用。

可运行 `./scripts/test-windows.ps1 -Desktop` 重测；设置 `SOFAPAD_PROBE_MANUAL=1` 可改为点击“开始验证”。

## 尚未验收

- 真实手机 Safari/Android 通过家庭 Wi-Fi 的完整操作、中文听写、常亮和锁屏恢复。
- 记事本、浏览器、文件管理器、终端的真实 Unicode、回车、退格、滚动与拖动（隔离测试窗口已通过）。
- 100%/150%/200% 与混合 DPI 多屏、负坐标、显示器切换。
- 60 分钟连续使用、多轮网络变化、电脑锁屏与休眠恢复。
- 用户电脑上的交互式安装、托盘菜单和实际注销登录后的自动启动；隔离环境的自动安装生命周期已通过。
- macOS 真机交互与分发；macOS CI 构建及自动测试已通过。
- Windows Authenticode 签名，macOS Developer ID 与公证。

发布应注明开发预览及这些限制，不能宣称完成真机验收。既有 [Mac 验证记录](validation.md) 不自动适用于 Windows。
