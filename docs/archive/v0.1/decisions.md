> 历史归档：0.1.0 开发预览，已被 [当前统一产品文档](../../product-blueprint.md) 取代，不作为新增开发要求。

# 可行性评估与实施决策

2026-09-09 · 蓝图 v1.2 评估与 0.1.0 实施结果。

**结论：适合做家庭影音场景的轻量触控板，核心工程路线可行，尚不能宣称完成客厅真机验收。** 已产出能编译、打包和打开的 Mac 原生 App，认证与网页控制链路通过本机真实网络栈和桌面浏览器测试。最大的不确定性在 iPhone Safari 与实际电视输入体验。

## 能力评估

| 能力 | 结论 | 实施结果或验证门槛 |
| --- | --- | --- |
| 内置网页 + 同源 WebSocket | 可实现，安装负担低 | SwiftNIO 同端口服务；桌面 Chrome 通过，Safari 待验 |
| 原生鼠标事件 | 公开 API 可实现 | CGEvent 编译通过；需辅助功能权限，真实点击/滚动未代测 |
| 单指/双指状态机 | 可实现，取消与互斥是重点 | 自动测试和 Chromium 两触点链路通过；iOS 边缘手势待验 |
| 配对与访问限制 | 可限制未经授权的控制 | 一次性令牌、Cookie、哈希记录与撤销；不能保护 HTTP 链路 |
| 前后台恢复 | 前台重连可实现，后台保活不可靠 | 桌面 20 次刷新恢复通过，服务端超时释放；iPhone 待验 |
| 登录启动 | macOS 13+ 公开系统接口支持 | SMAppService 已接入；实际安装和重新登录待测 |
| 屏幕键盘中文搜索 | 产品可用性的关键门槛 | 保留手动开启，焦点/候选词/目标视频 App 必须实测 |
| 电视低延迟 | 不能单靠软件保证 | 120 ms 是目标而非结果；需高速录像和电视参数 |

原生路线依据 [Apple CGEvent](https://developer.apple.com/documentation/coregraphics/cgevent) 和 [SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice)。macOS 局域网权限还与签名身份相关，命令行联网成功不代表 App 权限通过。[Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)

## 必要调整

1. **HTTP/WS 作为用户主动启用的家庭模式。** 首次默认关闭，Mac 明确勾选接受说明后才能启用；启用后记住运行选择。当前会话未取得用户对真实局域网启用的选择，因此只测试 loopback 假执行器，未替用户启用。HTTPS/WSS 仍需可信证书部署方案，不用自签名警告绕过或关闭浏览器安全检查代替。
2. **选定私有 IPv4 为首选，实际 `.local` 为可选入口。** 仅枚举 en* 以太网/Wi-Fi 的 RFC1918 地址，不监听 0.0.0.0、VPN、IPv6 或公网接口。地址/主机名变化时停止并提示重新开启。IPv6-only 和特殊桥接环境暂不支持。IP、主机名、端口切换可能需要重新配对。
3. **登录启动改为显式开关。** 使用 SMAppService，不默默注册；展示真实状态，安装到稳定路径后由用户启用。
4. **SwiftPM + `.app` 打包脚本。** 一个可执行目标、一个核心库和测试目标，避免额外工程生成器。Xcode 可直接打开 Package.swift，系统权限验证使用打包 App。SwiftNIO 精确锁定 2.102.0；传递依赖锁定在 Package.resolved。受 swift-collections 依赖影响，构建需要 Swift 6.2+。
5. **连续像素滚动，不合成惯性或 Quartz 阶段字段。** 协议仍闭合 begin/update/end/cancel；自然滚动反转仅在网页一处应用，真实内容方向待验。
6. **只使用公开生命周期通知。** 页面隐藏释放连接；Mac 系统睡眠、显示器休眠、会话切换暂停输入，恢复后显式重连。不使用私有锁屏检测 API，不承诺锁屏、登录窗或 FileVault 操作。

保留原有范围：不增加手机键盘、拖拽、屏幕镜像、云中继、遥测或自动发布。HTTP 下不承诺 Service Worker/完整离线 PWA，主屏幕入口单独验收。

## 核心实现边界

- 256-bit 配对令牌驻留内存，5 分钟有效且成功即消费；fragment 立即清除。30 天凭据通过 HttpOnly/SameSite=Strict Cookie 保存，Mac 仅持久化 SHA-256 哈希，文件权限 0600。
- Host 精确白名单，POST/WS 必须同源 Origin；重复 Cookie、恶意 Host/Origin、未知指令拒绝。没有通用命令、键盘或剪贴板入口。
- 最多 32 个有效浏览器记录、48 个连接；配对每 IP 10 次/分钟、全局 60 次/分钟；单消息 16 KiB，NIO 聚合最多 64 片段；应用消息 240 条/秒、原始帧 480 帧/秒。
- 单活动控制会话，3 秒握手期限，约 6 秒无应用消息释放。新 sessionID/seq，不保存离线动作；客户端背压超阈值断线。
- CGEvent 执行器逐条检查辅助功能权限，click 成对 down/up，第二次轻点只发 count=2 的第二次点击。自动测试使用假执行器。
- 非 App Sandbox 普通用户进程，Hardened Runtime；不要求 root、录屏、输入监控或完全磁盘访问。

这些限制不能防御 HTTP 链路窃听与篡改。[MDN WebSocket 客户端说明](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications)要求按实际浏览器策略验证连接；桌面结果不能替代 Safari。

## 下一步决策点

先验证 Safari 本地连接/配对/单击，再验证多指与锁屏返回，最后验证中文搜索和电视延迟。如果 Safari 阻止本地 HTTP/WS，转入可信 HTTPS/WSS 部署设计；如果屏幕键盘不可用，再依据实际使用场景讨论手机键盘范围。不会在缺少实测时扩大范围来掩盖风险。
