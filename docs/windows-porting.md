# SofaPad Windows 移植参考

> **0.10.0 实现更新**：本说明现作为移植设计基线保留。Windows 源码、构建与安装入口已加入 `WindowsApp/` 和 `scripts/*-windows.ps1`。当前使用说明见 [Windows 安装](windows-installation.md)，真实测试状态见 [Windows 验证](windows-validation.md)。以下“尚未实现”指本文最初交接时的状态，不代表最新源码状态；未完成的真机验收仍明确保留。

更新日期：2026-10-24。参考应用版本：**0.9.10**；产品基线：[v2.7](product-blueprint.md)；代码核对点：[c0b2638](https://github.com/keyzhao0118/sofapad/tree/c0b2638fe11493fdcbc05c0d964d9a41eb8721fd)。

**本文是供 Windows 电脑继续开发的交接说明，Windows 客户端、项目文件、构建脚本和安装包尚未实现，也未经过 Windows 真机验证。** 文中的新目录、接口和阶段安排均为建议；现有实现以本文链接的源码、协议和产品文档为参照。后续开发应记录实际使用的提交号，并核对基线之后的变更。

## 1. 目标与首版范围

在 Windows 上实现与现有 SofaPad 相同的核心体验：电脑运行一个轻量托盘应用，手机在同一局域网打开它提供的网页，即可把整屏当作触控板，并用手机键盘输入文字。继续维护同一仓库，共享 `Web/` 和 `Protocol/`，新增 `WindowsApp/`。

推荐首版目标为 **Windows 11 x64、已登录并解锁的普通桌面会话**。Windows 10、ARM64 可在首版之后单独验证，不据此承诺兼容。可行性高，主要工作是重写电脑端服务与系统输入层，并调好滚动、文字输入和多屏体验；不是把现有 Swift 程序直接重新编译。

必须保留的产品行为：

- 单指移动、轻点左击、双击；双指轻点右击、双指双轴滚动。
- 触控板长按约 **500 ms** 右击；三指拖动；轻点一次后第二次按住稍停再移动的拖动。
- 左右各 **28 CSS px** 的窄滚动区及外侧 **48 CSS px** 的方向判定带。落指锁定区域，混区加指取消；不在电脑端重新识别手势。
- 左上角设置、右上角键盘入口和收起入口，输入条固定在顶部。继续使用现有手机端动画和输入法处理。
- 实时提交文字、Backspace、Enter；手机不读取电脑输入框内容，不替用户切换电脑焦点。
- 指针速度、滚动速度、自然滚动、手机屏幕常亮保存到当前连接的电脑，重连读取，多手机同步。
- 启动即提供服务、托盘显示地址和连接状态、断开单个或全部控制者、可选登录启动。

不恢复已经移除的摇杆遥控模式、底部键盘入口、配对页面或二维码流程。当前产品没有账号、配对、云端中转、屏幕镜像、远程开机、解锁或任意组合快捷键；Windows 首版也不增加这些范围。

## 2. 从哪些文件开始读

| 现有文件 | 移植用途 |
| --- | --- |
| [产品蓝图](product-blueprint.md)、[安装教程](installation.md) | 确认现有交互与边界；教程中的系统权限、安装步骤为 Mac 专用 |
| [Web/src/gesture.ts](../Web/src/gesture.ts)、[app.ts](../Web/src/app.ts) | 复用手势识别、区域判定、帧合并和速度倍率 |
| [connection.ts](../Web/src/connection.ts)、[remote-settings.ts](../Web/src/remote-settings.ts) | 握手、心跳、重连、能力协商、设置同步 |
| [text-input.ts](../Web/src/text-input.ts)、[keyboard-transition.ts](../Web/src/keyboard-transition.ts)、[keyboard-viewport.ts](../Web/src/keyboard-viewport.ts) | 中文输入法、听写、删除、顶部输入与键盘过渡 |
| [keep-awake.ts](../Web/src/keep-awake.ts)、[wake-media.ts](../Web/src/wake-media.ts) | 常亮开关、Wake Lock 与本地无声视频兼容路径 |
| [协议说明](../Protocol/README.md)、[JSON Schema](../Protocol/schema/input-v2.json)、[共享样例](../Protocol/fixtures/messages.json) | Windows 服务必须兼容的消息格式与接受／拒绝行为 |
| [Protocol.swift](../MacApp/Sources/SofaPadCore/Protocol.swift) | 按连接维护的校验器、阶段约束、输入执行器接口 |
| [ControlSocket.swift](../MacApp/Sources/SofaPadCore/ControlSocket.swift)、[HTTPServer.swift](../MacApp/Sources/SofaPadCore/HTTPServer.swift)、[Security.swift](../MacApp/Sources/SofaPadCore/Security.swift) | 握手时限、HTTP/WS 路由、资源提供、Host/Origin 检查 |
| [ControlState.swift](../MacApp/Sources/SofaPadCore/ControlState.swift)、[ControlSettings.swift](../MacApp/Sources/SofaPadCore/ControlSettings.swift) | 多会话状态、输入串行化、粘贴去重、设置合并广播 |
| [MouseEventExecutor.swift](../MacApp/Sources/SofaPadCore/MouseEventExecutor.swift) | 小数余量、点击和拖动状态、输入后端分层；系统 API 需要替换 |
| [AppModel.swift](../MacApp/Sources/SofaPad/AppModel.swift)、[NetworkAddress.swift](../MacApp/Sources/SofaPad/NetworkAddress.swift) | 托盘对应的服务生命周期、网络地址选择思路 |
| [Web/tests](../Web/tests)、[Swift 测试](../MacApp/Tests/SofaPadCoreTests)、[HTTP/WS 集成测试](../Tests/Integration/server_test.py) | 可复用测试和需要翻译的行为用例 |

`docs/index.html` 是 GitHub Pages 宣传页，**不是手机控制页**。应用应提供构建后的 `Web/dist/`，不能拿宣传页当客户端。

## 3. 推荐技术方案

建议使用 **C# + .NET 10 LTS + Windows Forms 托盘 + Kestrel + Win32 SendInput**。截至本文日期，.NET 10 是受支持的 LTS；开发机安装 SDK，发布时携带运行时，最终用户不需要安装开发环境。[.NET 支持策略](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)、[Windows SDK 安装说明](https://learn.microsoft.com/en-us/dotnet/core/install/windows)

| 层 | 建议实现 |
| --- | --- |
| 托盘和菜单 | WinForms `ApplicationContext`、`NotifyIcon`，主线程保留 STA 消息循环；不弹常驻主窗口 |
| HTTP/WS | Kestrel 提供静态资源、`/api/status` 和原始 `/ws` WebSocket |
| 协议与共享状态 | 独立 C# 类，负责验证、会话、设置、去重；不依赖真实鼠标 |
| 输入执行 | 单个串行执行器 + 可替换 `IInputBackend`，Win32 后端负责实际系统调用 |
| 设置 | 当前 Windows 用户的 `%LOCALAPPDATA%\SofaPad\settings.json`，包含存储版本 |
| 分发 | 先产出 `win-x64` 自包含文件夹 ZIP，再做安装与卸载包 |

WinForms 提供系统托盘组件，Kestrel 可提供 HTTP 和 WebSocket 服务。[NotifyIcon](https://learn.microsoft.com/en-us/dotnet/desktop/winforms/controls/notifyicon-component-windows-forms)、[Kestrel](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/?view=aspnetcore-10.0)

沿用原始 JSON WebSocket，**不要直接改成 SignalR**，否则现有网页无法握手。网络异步任务不阻塞托盘消息循环；涉及剪贴板的工作交给 STA 线程。运行于当前交互用户会话，不做 Session 0 的 Windows 服务。首版不需要 Electron、WebView 或把 Swift 跨平台化。

建议的目录如下，均尚待创建：

```text
WindowsApp/
  SofaPad.Windows.slnx
  src/
    SofaPad.Windows/          # 托盘、启动、网络地址、休眠/锁屏生命周期
    SofaPad.Core/             # 协议、会话、设置、输入执行器和接口
    SofaPad.Input.Windows/    # Win32 P/Invoke、鼠标/键盘实现
  tests/
    SofaPad.Core.Tests/       # 共享样例、假输入后端、会话和设置测试
    SofaPad.Integration.Tests/ # 真 HTTP/WS + 无副作用后端
scripts/
  build-windows.ps1
  test-windows.ps1
  package-windows.ps1
```

WinForms 项目目标框架建议为 `net10.0-windows`，启用 Windows Forms 并引用 `Microsoft.AspNetCore.App` 共享框架来承载 Kestrel；纯协议 Core 可用 `net10.0`。建项目时添加适当的 `bin/`、`obj/`、`.vs/` 忽略规则，并锁定 SDK 与依赖版本。保持 Mac 的构建和打包入口独立。

## 4. Windows 电脑上的开始步骤

准备 Git、.NET 10 SDK、Node.js 22 或更新的受支持版本、pnpm；要适配现有 Python 集成测试时再装 Python 3。可用 Visual Studio 或 VS Code；不需要 Xcode。

以下是**对当前仓库即可执行**的 PowerShell 命令。首次克隆到新目录执行；若已有仓库，先保存工作，再更新分支，不要重复克隆覆盖：

```powershell
git clone https://github.com/keyzhao0118/sofapad.git
Set-Location sofapad
git switch -c windows-port
git rev-parse HEAD
dotnet --list-sdks
node --version
pnpm --version
pnpm --dir Web install --frozen-lockfile
pnpm --dir Web test
pnpm --dir Web build
```

这一步只验证共用网页，输出 `Web/dist/`；不会生成 Windows 程序。若 PowerShell 的执行策略拦截 pnpm 脚本，可使用安装提供的 `pnpm.cmd`。现有 `scripts/build.sh`、`test.sh`、`package.sh` 会调用 macOS 工具，不能作为 Windows 构建命令。

下一步才按第 3 节建 C# 项目。建议先提供无系统输入的预览后端，连接真实手机并打通完整握手和心跳，再启用真实 `SendInput`。预览模式必须显示明确标识，不能把日志中收到了消息视为电脑已经完成输入。

## 5. 必须兼容的协议

完整约束以 [协议说明](../Protocol/README.md)、[ProtocolValidator](../MacApp/Sources/SofaPadCore/Protocol.swift) 和 [共享样例](../Protocol/fixtures/messages.json) 交叉核对。Schema 只覆盖结构，不能替代会话、UTF-8 字节长度、去重、限速和阶段状态检查。

### 5.1 HTTP 与握手

- HTTP 和 WS 共用默认端口 `9876`；手机访问 `http://<Windows 局域网 IPv4>:9876/`。
- `GET /api/status` 返回 `name`、`permitted`、`controllers`、`preview`、`v: 2`。先查状态再连接同源 `/ws`。
- 网页在 WS 建立后发送 `{"type":"hello","v":2}`，服务在收到合法 hello 后返回 `ready`。
- 每条连接生成新的 `sessionID`；进程启动时生成一次 `pasteEpoch`，服务暂停再开启不更新 epoch。
- `doubleClickInterval` 的协议单位是**秒**。Windows `GetDoubleClickTime()` 返回毫秒，应除以 1000；现有网页再转成毫秒并限制在 100–2000 ms，超出这一范围的系统偏好需要后续单独讨论。[API 说明](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdoubleclicktime)

完整能力实现后的 `ready` 示例（ID 是示例，每次按上述生命周期生成）：

```json
{
  "type": "ready",
  "v": 2,
  "sessionID": "a39d1557-cdf2-4824-bcc3-735c2e18c23b",
  "pasteEpoch": "11111111-2222-3333-4444-555555555555",
  "name": "客厅电脑",
  "permitted": true,
  "doubleClickInterval": 0.5,
  "preview": false,
  "capabilities": ["backspace", "edit", "enter", "settings"],
  "settings": { "pointer": 1.5, "scroll": 0.3, "natural": true, "keepAwake": true },
  "settingsRevision": 0
}
```

只声明实际实现的能力。`paste` 是旧 v2 的基础行为，不在上述能力数组中；仅不声明 `edit` 会让新页面退回 `paste`，不能把“没有实现实时输入”误当成“页面不会发送文字”。开发阶段可暂时返回 `unavailable`，但不能伪造 `executed` 或据此宣称完整兼容。

### 5.2 消息和生命周期

| 消息 | 执行要求 |
| --- | --- |
| `move` | 已缩放的相对位移，右／下为正；保留小数余量 |
| `click` | `button` 为 left/right；左击 `count` 为 1/2，右击仅 1；每条仅一次 down/up |
| `scroll` | 严格 begin → update* → end/cancel，结束位移为 0；接收双轴输入 |
| `drag` | 同样的阶段约束；begin 按下左键再移动，update 移动，end/cancel 释放 |
| `edit` | 先执行 `delete` 次退格，再输入已提交的 `text`；默认 0／空，但不能都为空 |
| `backspace`、`enter` | 各执行一次对应按键的按下／抬起，无自定义键码、无自动重发 |
| `paste` | 剪贴板回退路径，带 requestID 和结果回执；保留跨重连去重 |
| `settings` | 部分字段更新，持久化完整快照，修订号递增并广播 |
| `ping` | 原样回 `{"type":"pong","nonce":"收到的值"}`，不注入输入 |
| `disconnect` | 清理会话和该会话持有的按键；不影响其他会话拥有的拖动 |

所有 hello 之后的客户端消息使用 `v=2`、当前 `sessionID`、正整数 `seq`。序号严格递增，允许跳号，上限 `9007199254740991`；不能以 32 位整数存储。每个 socket 独立验证，断线后的未完成动作和文本不重放。

保留以下数值限制：

| 项目 | 基线 |
| --- | --- |
| 完整 JSON / WS 消息 | ≤16,384 UTF-8 字节；只接受合法 UTF-8 文本消息 |
| move / scroll / drag 位移 | 有限数；每轴绝对值 ≤2000 |
| edit | `delete` 为 0–1024 整数；`text` ≤4096 UTF-8 字节；网页按 128 次删除 / 512 字节分批 |
| paste | 非空且 ≤12,000 UTF-8 字节；不 trim、不规范化、不静默截断 |
| requestID | 38–100 字节，ASCII 字母／数字／冒号／连字符，并验证当前 epoch 前缀 |
| 应用消息 | 每连接 ≤240 条/秒；原 Mac 端另有原始帧 ≤480/秒、≤64 个聚合片段限制 |
| 建连与心跳 | hello 等待约 3 秒；应用心跳约 2 秒；约 6 秒无有效消息清理，检查节拍 1 秒 |
| 连接与去重表 | 原服务最多 48 个活动连接；进程级 paste 回执最多 1024 条 |

WS 原生 ping/pong 不替代应用心跳。阶段错误、旧会话、重复序号、未知消息、超限均拒绝并清理；活动滚动／拖动期间拒绝该会话的 move、click、edit、paste、backspace、enter。settings 和 ping 仍可处理。

Kestrel/.NET 的 `ReceiveAsync` 不保证一次读取就是完整消息；应累积至 `EndOfMessage`，同时限制累计字节、读取期限和资源占用。它也不等同于 SwiftNIO 原始帧回调：不能把一次 receive 当一帧来声称复刻了 480 帧／64 片段限制。需要补恶意分片测试，记录所选网络层能提供的约束及替代限制。[ASP.NET Core WebSocket 文档](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/websockets?view=aspnetcore-10.0)

### 5.3 多手机与已知参考差异

输入执行器应是全局唯一、串行访问。每个会话维护独立协议状态，但同一时刻只有一个活动滚动／拖动拥有者；其他会话的冲突输入不执行、不排队重放。非拥有者的 end/cancel 或断线不得释放拥有者的左键。争用中被忽略的手势应一直忽略至自身结束，不能在拥有者松手后从一个 update 中途接管。

**需要补齐的基线差异：** 当前 `ControlState.swift` 已记录 `gestureOwner`，但 `process` 在交给执行器之前没有完整过滤非拥有者输入。移植时应按产品要求补齐仲裁，不能仅逐句翻译这段代码。加入“A 拖动、B 点击／开始另一拖动／结束／断线”的测试，验证 A 不被误释放；这份参考说明没有修改 Mac 实现。

Schema 标题仍含历史用词 `authenticated`，不代表当前系统有认证。协议说明中个别“单控制者”描述也是旧表述；当前目标是多连接、独立会话、手势争用仲裁。遇到这类差异要记录并测试，不把旧文字或源码遗漏继续复制。

## 6. Windows 输入层的实现重点

### 6.1 鼠标移动、点击和拖动

用可替换的后端封装 Win32 API，便于假后端记录事件。检查 `SendInput` 的实际返回数量；部分投递不能视为整批成功。正确声明 `INPUT` 联合体和指针宽度字段，按运行架构计算结构大小，避免 x64 P/Invoke 布局错误。[SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)

推荐先用“读取当前光标位置 + 位移 → 绝对位置注入”实现可控手感，类似当前 Mac 的路径：累积浮点余量，只投递整数增量；定位采用物理像素；启用 Per-Monitor V2 DPI 意识，处理负坐标、不同缩放、多显示器空隙和边界。[Windows DPI 说明](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows)

若使用绝对 `SendInput`，须将虚拟桌面坐标映射到 0–65535，并设置 `MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK`。若选择相对 `MOUSEEVENTF_MOVE`，需验证 Windows 指针加速对手感的影响。**网页已应用指针倍率，电脑端不要再乘一次用户倍率，也不要修改用户全局鼠标速度。** [MOUSEINPUT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-mouseinput)

双击最容易写错：网页发送 `count=1` 后再发送 `count=2`；第二条表示双击中的第二次点击，**不是再发送两次点击**。每条投递一对 down/up，Windows 根据时间、位置和目标控件形成双击。不要向某个窗口硬发 `WM_LBUTTONDBLCLK` 替代系统输入。

拖动 begin 在当前位置按左键，然后应用首段位移；结束、取消、拥有者断线、超时、暂停、锁屏、退出都尝试释放本程序按下的键，并清空余量。即使当前不允许输入，也应尝试清理，不提前被 `permitted` 判断拦住。只追踪和释放自己合成的按下状态，不随意释放用户物理键盘上的按键。

### 6.2 滚动：首轮体验验证的重点

Mac 当前使用像素滚动；Windows 的 `MOUSEEVENTF_WHEEL` / `HWHEEL` 使用滚轮增量，标准刻度为 120。**不能把每个网页滚动更新都换成一个 ±120 刻度**，否则轻滑会跳多行。较细的增量能否平滑响应还取决于目标应用。[滚轮字段说明](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-mouseinput)

建议在 Windows 后端集中实现单位转换，并保留两轴的小数余量；begin 初始化，update 累积，end/cancel 清理，不在手势结束后突然补一个整刻度。先让浏览器慢速可控，再检查文件管理器等对小增量的响应，实测后决定是否需要整刻度累积兼容策略，不凭空写一个“通用最佳系数”。

网页已经乘了 `0.4 × settings.scroll` 并处理自然滚动开关，Windows 仅做系统单位与轴方向适配，不能重复乘倍率或重复反转。横向与纵向正负方向分别测试；边缘滚动只发送纵向，中央双指滚动发送双轴。

验收目标：轻滑可以小幅阅读、快速滑动可以连续浏览、反向没有明显迟滞、松手没有延迟跳动。记录 Windows 滚轮系统设置、目标应用和转换系数，让以后调参有依据。

### 6.3 文字、退格和回车

实时 `edit` 默认走 `KEYEVENTF_UNICODE`，`wVk=0`，按 UTF-16 编码单元依序构造 down/up；正确保留代理对、组合字符和原始换行，不把中文字符串按本机 ANSI 编码转换。[KEYBDINPUT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-keybdinput)

- 只输入手机已提交的文本；拼音候选、组合中的删除由现有网页处理，Windows 不再运行第二套 IME 推断。
- `delete` 表示发送指定次数的 Backspace；`backspace` 使用 `VK_BACK`（0x08），不是 `VK_DELETE`；`enter` 使用 `VK_RETURN`（0x0D）。
- 当前 Mac 代码的 `kVK_Delete` 数值 0x33 和 `kVK_Return` 数值 0x24 **不能直接搬到 Windows**。
- 保持当前焦点，不弹窗抢焦点、不自动切换输入法、不附加 Enter；普通文字路径不使用剪贴板。
- 一个 Backspace 如何处理 emoji／字素簇取决于目标控件，不能承诺 Windows 所有应用“一次删除一个完整可见字符”。听写的尾部修订尤其要测试这一点。
- 普通编辑框、浏览器、终端对 Unicode 注入可能有差异。检查事件投递结果也不能证明文字已被目标控件接受；不要通过读取控件内容来扩展当前产品范围。

### 6.4 保留 paste 回退

`paste` 与实时输入分开：写 Unicode 剪贴板，再发送一次 Ctrl+V，保留粘贴后的剪贴板，不自动恢复旧内容。剪贴板访问在 STA 上处理；失败返回 `clipboard_failed`，不继续发快捷键。尊重原有 `permission`、`unavailable`、`busy` 等结果，不谎报成功。

进程内保存 `requestID → 文本 SHA-256 + 首次结果`，跨 socket 有效；相同 ID 相同文本返回原结果，相同 ID 不同文本返回 `id_conflict`。失败也缓存；1024 条满额返回 `limit`，不要淘汰旧条目后允许重复执行。旧 epoch 返回 `expired`。客户端 6 秒超时或发送后断线只提示确认，不自动补发。`executed` 表示事件已投递，不保证目标接受。

## 7. 服务、网络与权限

优先选择活动 Wi-Fi／以太网的私有 IPv4，避免把 VPN、虚拟机网卡误作为主地址；多网卡时允许选择。绑定选定地址，开发预览绑定回环地址。首版显示可复制的 IPv4 URL；Mac 的 `.local` 名称依赖平台机制，Windows 不应仅给机器名加 `.local` 就声称可访问。

随应用完整打包 `Web/dist/` 的全部构建资源，特别是 ES module `.js` 文件；只服务发布资源目录，不暴露源代码、设置或日志。验证 HTML、CSS、JS MIME 和 `no-store`；避免新模块未打包导致页面看似打开却一直连接中。保留 CSP 的 `media-src 'self' data:`，否则本地无声视频常亮路径可能被阻止。

保留精确 Host/Origin 校验、拒绝跨站请求、消息大小和连接资源限制。WebSocket 不是靠开放 CORS 就安全；不要为连接方便设置任意来源。与 Mac 一样使用明文 HTTP/WS、无身份认证，仅面向可信家庭局域网；Host/Origin 校验不是用户身份验证，也不能阻止同一网络里的其他客户端连接。

首次使用引导用户只在需要的私有网络允许应用通过 Windows 防火墙；给出“服务未启动、端口占用、手机不在同网段、防火墙、访客 Wi-Fi 隔离”的分步排查，不要求关闭防火墙。安装／卸载要管理本应用创建的规则。

普通权限程序受 UIPI 限制，不能向更高完整性级别应用注入输入；UAC 安全桌面和锁屏不在首版范围。**默认使用普通权限，不把整个网络服务设为管理员运行来绕过限制。** `SendInput` 失败也不能单凭错误码确定是 UIPI。[权限约束](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)

`permitted` 在 Windows 表示当前主机是否允许正常桌面输入，不等同于 macOS 辅助功能授权，也不是“任意目标一定可控”。锁屏／休眠时按既有 `host_paused` 路径断开并清理；恢复时重新开放服务，由网页按现有策略重连。

## 8. 共用网页要做的少量适配

保留一份 `Web/`，不复制成逐渐分叉的 Windows 网页。先处理 [connection.ts](../Web/src/connection.ts)、[app.ts](../Web/src/app.ts)、[text-input.ts](../Web/src/text-input.ts)、[index.html](../Web/src/index.html) 中的 Mac 固定文案，包括可访问性标签和失败提示。

普通提示可统一为“电脑”；“授予辅助功能权限”需要按主机平台显示。建议将 `platform: "macos" | "windows"` 作为 `/api/status` 与 `ready` 的可选扩展，并在缺省时兼容旧 Mac；这是**待实现的协议扩展**，不是当前已有字段。新增字段要同步协议文档、类型和测试，避免修改 v2 已有必填字段或靠手机 User-Agent 判断电脑平台。

不要为了 Windows 移植改掉顶部键盘入口、输入条定位、手势时序或恢复摇杆。手机浏览器的键盘用户触发要求、常亮兼容性、后台断开和系统手势冲突仍然存在，换电脑端不会自动消除这些限制。

## 9. 设置、托盘与分发

设置默认值为 `pointer=1.5`、`scroll=0.3`、`natural=true`、`keepAwake=true`；范围分别为 0.2–5、0.05–5，两个开关仅接受布尔值。`keepAwake` 管的是手机网页，不代表阻止 Windows 电脑休眠。

服务在串行状态处理中按字段合并 patch，写入带版本的 JSON 快照，再递增 `settingsRevision` 并广播；同字段以后接受的修改为准，不同字段不相互覆盖。文件通过临时文件替换等方式避免半写，损坏时回默认并保留可诊断信息；写入失败不要让网页显示“已保存”。修订号可在进程重启后重新开始，网页在新连接读取完整快照；手机不维护离线设置队列。

设置属于各电脑本地用户：连接 Windows 读取 Windows 设置，回到 Mac 读取 Mac 设置。没有跨电脑云同步。托盘提供服务开关、复制地址、连接者列表与断开、登录启动开关、版本和退出；退出先释放输入、关闭会话再停止服务。

先发布带 `Web/` 和许可证的自包含 ZIP，再补安装包、卸载、升级保留设置和签名验证；首版不急于单文件压缩或裁剪。自包含发布可携带运行时，但不是“只复制 exe 就能运行”的保证，需一起分发完整输出目录。[.NET 发布说明](https://learn.microsoft.com/en-us/dotnet/core/deploying/)

以下是**按第 3 节建立项目之后**的目标命令，目前仓库里还没有这些项目：

```powershell
pnpm --dir Web build
dotnet test WindowsApp/SofaPad.Windows.slnx -c Release
dotnet publish WindowsApp/src/SofaPad.Windows/SofaPad.Windows.csproj -c Release -r win-x64 --self-contained true -o build/windows-x64
```

项目文件或 `build-windows.ps1` 必须把 `Web/dist/` 自动复制到输出中的 `Web/`，并以 `AppContext.BaseDirectory` 等发布位置定位，不能依赖开发机工作目录。测试预览使用独立临时设置目录，不修改真实用户设置。打包时保留 SofaPad MIT 和网页所用 NoSleep 等依赖许可，按实际 Windows 依赖更新 [第三方说明](third-party-notices.md)，不照搬无关的 Swift 运行依赖。

## 10. 分阶段实现与通过条件

| 阶段 | 工作 | 可验证结果 |
| --- | --- | --- |
| W0：可运行骨架 | 建工程、提供网页、状态接口、握手、心跳、假后端 | 真手机能连接，所有资源 200；预览不产生系统输入；异常握手会退出 |
| W1：输入最小闭环 | 指针、单／双击、滚动、Unicode、Backspace、Enter | 在 Windows 浏览器完成“输入中文搜索 → 点击 → 滚动”；优先确认手感与文字可用 |
| W2：完整行为 | 拖动、右击、协议校验、paste 去重、设置、多会话仲裁、生命周期 | 共享样例通过；断网不粘键、不重放文本；重启后设置一致 |
| W3：分发与回归 | 托盘、登录启动、防火墙引导、构建脚本、ZIP／安装包、平台文案 | 干净 Windows 机器不装 Node/.NET SDK 也能运行，更新保留设置，Mac 网页兼容 |

每阶段把完成状态、实测环境和失败项写进验证记录。W0/W1 是开发里程碑，不是完整 Windows 兼容版；只有真实实现后才能在 README、Pages 和 Release 中宣称支持 Windows。

## 11. 测试与验收清单

### 自动化

- 运行现有 `pnpm --dir Web test`；保持手势、IME、设置、常亮、顶部键盘动画的用例通过。
- 将 52 组 [协议样例](../Protocol/fixtures/messages.json) 纳入 C# 校验器测试；每组独立会话，替换示例 sessionID/epoch，不把 Schema 验证通过当完整兼容。
- 翻译 [InputTests.swift](../MacApp/Tests/SofaPadCoreTests/InputTests.swift) 的假后端测试，重点覆盖小数累积、第二次点击、拖动释放、文字顺序、粘贴失败；增加 SendInput 部分失败与清理测试。
- 增加多手机争用、序号边界、阶段互斥、文本字节限制、设置并发合并／写失败／重启恢复的测试。
- 复用 [Python 集成测试](../Tests/Integration/server_test.py) 的原始 HTTP/WS 测试方法。当前启动路径硬编码 `.build/debug/SofaPad`，不能直接在 Windows 运行；先参数化可执行程序路径和预览启动方式，或用 C# 写等价测试。
- 保留 `--preview-server`、`--port`、`--web-root`、`--info-file` 等测试入口的语义或提供明确适配，并隔离真实输入与用户设置。未实现这些参数前不要直接复用启动命令。
- 新增 Windows CI 时构建网页、执行假后端测试和打包资源完整性检查；CI 通过不代表交互桌面输入或手机体验已通过。

### Windows 真机

| 场景 | 验收重点 |
| --- | --- |
| iPhone Safari + Windows Edge/Chrome | 真 Wi-Fi 连接、每种手势、顶部键盘呼出／收起、中文搜索完整流程 |
| 记事本、浏览器输入框、文件管理器、Windows Terminal | 中文、英文、emoji、组合字符、空格换行、选区替换、退格与回车；逐应用记录兼容性 |
| 滚动 | 双指双轴、左右边缘、慢速细调、快速滑动、自然方向切换、反向和松手 |
| 指针与拖动 | 小距离精确定位、双击只产生两次点击、拖窗口／选中文字／拖滑块、拖动中断网 |
| 显示器 | 100%/150%/200% 缩放、主副屏切换、负坐标、不同缩放跨屏和边界 |
| 多手机 | A 拖动时 B 操作和断线不释放 A；A 断开后 B 新手势可接管；设置同步 |
| 生命周期 | 页面切后台、锁屏／解锁、电脑休眠恢复、主机主动断开、退出、物理鼠标同时操作 |
| 网络与分发 | 首次防火墙、访客网络隔离、端口占用、换网、多网卡、干净机器安装／升级／卸载 |
| 常亮 | 开关持久化、无声视频实际播放状态、锁屏前等待、低电量与浏览器差异；不得只凭 API 返回值判定成功 |

至少完成 60 分钟连续使用与多轮断线恢复；记录操作系统、手机／浏览器、电脑应用版本、缩放与网络。可测 RTT、事件排队时长和实际响应，但不要把 RTT 当作单向输入延迟。当前 Mac 的自动测试结果不能计作 Windows 的验证结果。

## 12. 可以直接交给 Windows 开发助手的任务

复制下面内容，在 Windows 电脑克隆后的仓库中开始：

> 请先阅读 docs/windows-porting.md、docs/product-blueprint.md、Protocol/README.md，并对照当前提交的代码和共享样例，为 SofaPad 新增 Windows 11 x64 电脑端。沿用 Web/ 的触控板、顶部键盘和设置交互；新增 WindowsApp/，采用 C#/.NET 10、WinForms 托盘、Kestrel 原始 WebSocket、Win32 SendInput。先做 W0 的无副作用预览、协议和服务测试，再做 W1 的指针、滚动、Unicode、Backspace 和 Enter。随后补 W2/W3。不要恢复摇杆或配对，不改成 SignalR，不运行管理员网络服务，不破坏 Mac 构建。特别核对 count=2 只执行第二次点击、滚动单位转换、拖动断线释放、UTF-8 限制和多会话仲裁。保留正常文本不经剪贴板、焦点不被抢占、断线不重放、电脑持久化设置的行为。输出可运行构建、构建测试打包说明，以及自动测试和 Windows 真机仍待验证的清单；不要把模拟后端或 CI 通过写成真实输入验收通过。

本文只提供开发起点。后续 Windows 实现、测试结论、安装包与下载入口应随实际进展更新，当前 Mac 0.9.10 下载包不包含 Windows 程序。
