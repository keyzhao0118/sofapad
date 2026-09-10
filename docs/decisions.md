# 可行性评估与实施决策

2026-09-09 · 基于 [统一产品文档 v2.0](product-blueprint.md)。核心方案可在现有工程上局部重构，保留 Mac 服务、配对、权限、手势状态机与打包基础。主要风险在真实 iPhone 的三指系统手势、输入法事件顺序和首次证书部署；这些需要目标设备验证，不能用编译成功替代。

## 能力与取舍

| 能力 | 本轮结论与实现 |
| --- | --- |
| 最大化触控面积 | 触控面覆盖 visualViewport，无标题／工具栏；用户最新要求的左上角手感按钮与右下角模式按钮悬浮 |
| 手机原生键盘输入 | textarea 同步聚焦，compositionend 后等最终 input，再读取完整内容；草稿只在当前页面保留 |
| 三指拖动 | 拓展既有状态机与 CGEvent 后端，第三指加入窗口、中心阈值、first-up 释放；Safari 系统抢占仍是真机门槛 |
| Mac 粘贴 | NSPasteboard 写入成功才发 Command + V；无目标查找、焦点切换、Enter 或恢复剪贴板 |
| 一次请求不重复执行 | 设备维度结果表跨 socket 存活，进程 epoch 防重启重放；不淘汰已用 ID，满额拒绝；不承诺跨进程事务回执 |
| 结果反馈 | “指令已执行”仅表示已写入并投递事件，不能判定目标应用接受；断线或超时显示不确定 |
| 通信保护 | swift-nio-ssl 内嵌 HTTPS/WSS，导入已准备好的 PEM；不提供自动签发／续期，TLS 失败不降级 |
| 初次部署 | 可信证书存在一次配置成本；本轮保留明确标识的 HTTP 开发入口，正式使用须完成 Safari 信任配置 |
| 生命周期 | 沿用公开睡眠／显示器／用户会话通知与双端心跳；增加拖动释放；普通恢复自动重连，主动断开仍尊重用户 |
| Mac 界面 | 连接、授权和配对为主，低频安装选项折叠；不发展成遥控配置中心 |

## 原需求冲突的处理

新稿覆盖旧蓝图的“仅鼠标／屏幕键盘输入／拒绝所有三指／不保持鼠标按下”。最新聊天补充覆盖新稿的“禁止手感设置”。旧稿的鉴权、单控制者、同源访问、授权、自启动、无云、同仓库和真实测试门槛继续保留。

模式中“只有必要控件”不意味着删除连接失败提示。忙碌、缺权、未配对、发送不确定时显示短反馈；正常状态不占用触控面积。手机断开／忘记设备的常驻入口移除；Mac 保留断开和撤销。

## 实现映射

| 模块 | 变化 |
| --- | --- |
| `Web/src/app.ts`、`index.html`、`style.css` | 整屏两模式、浮动设置、软键盘视口、触控互斥与草稿保留 |
| `Web/src/gesture.ts` | 三指候选／拖动／阻止余下触点，拖动和滚动严格分离 |
| `Web/src/text-input.ts` | IME 延后提交、防重复、取消未发请求、结果文案 |
| `Web/src/connection.ts` | v2、paste 回执、请求编号、发送大小限制、无自动重发 |
| `Protocol.swift`、`ControlState.swift`、`ControlSocket.swift` | 状态与大小校验、去重、回执、会话释放 |
| `MouseEventExecutor.swift` | 可注入系统后端；拖动按下／拖移／释放，先写剪贴板后粘贴 |
| `ServerTLS.swift`、`HTTPServer.swift`、`Security.swift` | 可选 TLS 管线、精确 scheme／origin、Secure Cookie |
| `AppModel.swift`、`SofaPadApp.swift` | 精简设置窗口、证书导入、开发 HTTP、正常退出释放 |

## 维持的工程边界

SwiftPM + TypeScript，无第三方前端运行时。SwiftNIO 2.102.0 和 swift-nio-ssl 2.37.4 精确锁定；传递依赖见 Package.resolved。构建需 Swift 6.2+，脚本打包网页、资源和第三方许可。

仅选定 en* 私有 IPv4，端口 9876；不用 0.0.0.0、私有锁屏 API、root 或录屏。连续像素滚动不合成惯性／Quartz 滚动阶段。所有鼠标和粘贴副作用在 ControlState 锁内串行；去重只存文本摘要与结果。不可随意增加键码或任意命令入口。

参考公开接口：[CGEvent](https://developer.apple.com/documentation/coregraphics/cgevent)、[NSPasteboard](https://developer.apple.com/documentation/appkit/nspasteboard)、[SwiftNIO SSL](https://github.com/apple/swift-nio-ssl)。本项目的真实通过项以 [验证记录](validation.md) 为准。
