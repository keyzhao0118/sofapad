# SofaPad protocol v2

协议随 App／网页一起更新，v1 页面需要刷新。产品行为以 [统一文档](../docs/product-blueprint.md) 为准，JSON 结构见 [schema/input-v2.json](schema/input-v2.json)；旧 schema 仅留在 archive/。

HTTP/WS 同一端口（默认 9876），不做配对：`GET /api/status` 返回名称、当前控制者数量、辅助功能权限与协议版本；同源 `/ws` 直接开始控制。服务端精确校验 Host 与 Origin，只接受绑定的地址；每个连接一个独立会话，多台设备可以同时控制（序号按会话各自递增）。局域网内任何设备都能访问，明文传输。

## 握手与会话

```json
{"type":"hello","v":2}
{"type":"ready","v":2,"sessionID":"new-session-id","pasteEpoch":"11111111-2222-3333-4444-555555555555","name":"Mac","permitted":true,"doubleClickInterval":0.5,"preview":false,"capabilities":["backspace","edit","enter"]}
```

3 秒内 hello；每条输入、ping、disconnect 均包含 v=2、当前 sessionID、从 1 开始严格递增的 seq（最大 9007199254740991）。每次 socket 使用新 sessionID，旧动作不重放。允许多台设备同时控制：每个连接独立会话，同时操作时以先开始的手势为准，其他会话的移动／点击／滚动会被忽略直到该手势结束；Mac 菜单里的“断开”会一次性结束全部会话。

```json
{"type":"move","v":2,"sessionID":"new-session-id","seq":1,"dx":3.2,"dy":-1.5}
{"type":"click","v":2,"sessionID":"new-session-id","seq":2,"button":"left","count":1}
{"type":"click","v":2,"sessionID":"new-session-id","seq":3,"button":"left","count":2}
{"type":"scroll","v":2,"sessionID":"new-session-id","seq":4,"phase":"begin","dx":0,"dy":6}
{"type":"scroll","v":2,"sessionID":"new-session-id","seq":5,"phase":"end","dx":0,"dy":0}
{"type":"drag","v":2,"sessionID":"new-session-id","seq":6,"phase":"begin","dx":10,"dy":2}
{"type":"drag","v":2,"sessionID":"new-session-id","seq":7,"phase":"update","dx":3,"dy":1}
{"type":"drag","v":2,"sessionID":"new-session-id","seq":8,"phase":"end","dx":0,"dy":0}
```

move／scroll／drag 的 dx、dy 有限且绝对值 ≤2000，右／下为正。网页应用倍率和自然滚动方向，服务端不重复乘。左击 count=1/2，右击仅 1；双击第二次消息仅执行第二次 down/up，Mac 另核对时间和位置。

scroll 和 drag 各自严格 begin → update* → end/cancel，结束 dx=dy=0，两者互斥。任何活动拖动／滚动期间拒绝 move、click、paste、backspace。drag begin 在当前位置发送 leftMouseDown 后 leftMouseDragged，end/cancel 或会话清理释放。协议 scroll 阶段不等于模拟 Quartz 惯性或手势阶段。0.5.0 的网页在已保存滚动倍率之外统一乘 0.4 基础系数，服务端仍只执行收到的位移。

## 文本与回执

```json
{"type":"paste","v":2,"sessionID":"new-session-id","seq":9,"requestID":"11111111-2222-3333-4444-555555555555:00112233445566778899aabbccddeeff","text":"  中文 👩🏽‍💻\n下一行\n"}
{"type":"pasteResult","requestID":"11111111-2222-3333-4444-555555555555:00112233445566778899aabbccddeeff","status":"executed","duplicate":false}
```

requestID 由当前进程 pasteEpoch、冒号、128-bit 随机值组成。协议限制 ASCII 字母／数字／冒号／连字符，共 38～100 字节，并检查 epoch 前缀。text 非空、≤12,000 UTF-8 字节；完整 JSON ≤16,384 字节，转义也占空间。不 trim、不规范化、不自动截断。

Mac 保存 requestID → 文本 SHA-256 摘要与结果。跨 socket 重连仍生效；同 ID 同内容回原结果且 duplicate=true，同 ID 不同内容回 id_conflict，不重复执行。失败结果也保留，上限 1024，不移除旧 ID 腾空间；满额回 limit。重启进程换 epoch，旧编号回 expired。停止／开启服务不重置进程 epoch。

| status | 含义 |
| --- | --- |
| executed | 剪贴板写入成功，粘贴事件已投递；不保证目标应用接受 |
| clipboard_failed | 剪贴板写失败，没有发送粘贴快捷键 |
| permission | 辅助功能权限不可用或主机暂停 |
| unavailable | 无法生成粘贴事件；剪贴板可能已更新 |
| busy | 执行器仍在拖动；正常协议应先结束拖动 |
| expired | 会话或 epoch 失效，未执行 |
| id_conflict | 同一 ID 已用于不同文本，未再次执行 |
| limit | 结果表达到上限，未执行新请求 |

手机一次只保留一个未决提交；回执按 ID 匹配，6 秒未获结果或已发送后断线，显示“请查看电视确认是否已粘贴”，不自动重试。未发送则提示尚未发送，不存离线队列。客户端本地还使用 not_sent、too_large、uncertain 表示这些状态。新一次主动点击才生成新 ID。

## 单次退格

```json
{"type":"backspace","v":2,"sessionID":"new-session-id","seq":10}
```

0.5.0 在 v2 中增加固定 backspace 类型。Mac 的 ready 使用 `capabilities: ["backspace"]` 声明支持；没有该能力的新页面禁用退格按钮，旧页面继续使用原有 v2 指令。没有任意键码、修饰键、重复次数或长按参数。Mac 在当前焦点投递一对 kVK_Delete（0x33）keyDown/keyUp，flags 为空、autorepeat 为 0；这是向后退格，不是 Forward Delete。

退格使用既有单控制者、权限、sessionID、递增 seq 和速率限制；重复序号拒绝，活动滚动／拖动期间拒绝，缺权时不投递。客户端仅输入模式可点，粘贴进行中禁用；不修改手机草稿，不访问剪贴板，不切换 Mac 焦点。每次点击立即发送一次，不提供回执、不排队或自动重发，结果由用户查看目标应用确认。

## 回车

```json
{"type":"enter","v":2,"sessionID":"new-session-id","seq":13}
```

0.8.0 在 v2 中增加固定 `enter`：Mac 在当前焦点投递一对 kVK_Return（0x24）keyDown/keyUp，flags 为空、autorepeat 为 0。目标应用决定换行、确认或提交，客户端不做补充或拦截。ready 以 `capabilities: ["backspace","edit","enter"]` 声明；没有该能力的旧主机上，手机回车仍按普通换行文本处理。

`enter` 与 `backspace` 一样受单控制者、权限、递增 seq、速率限制和活动手势限制（滚动／拖动期间拒绝），不发回执、不排队、不重发。除这两个固定键外仍不开放任意键码、修饰键或组合键。

## 实时输入同步

```json
{"type":"edit","v":2,"sessionID":"new-session-id","seq":12,"delete":2,"text":"好"}
```

0.8.0 在协议 v2 中增加 `edit`：先按 `delete` 次数投递退格，再键入 `text`。两个字段都可省略（省略即 0／空），但不能同时为空。`delete` 取值 0…1024，`text` ≤4096 UTF-8 字节；完整消息仍受 16,384 字节限制。单控制者、权限、sessionID、递增 seq、240 消息／秒与活动手势限制不变，拖动／滚动期间拒绝。

Mac 的 ready 以 `capabilities: ["backspace","edit"]` 声明能力；没有 `edit` 的旧主机继续使用 `paste` 与 `backspace`。键入走系统文本合成：无键码、无修饰键、不经剪贴板、不切换焦点、不附加回车；退格按组合字符（字素簇）一次删除一个。客户端只发送已提交文本（不含 IME 候选缓冲），输入框提交后立即清空、仅保留一个零宽哨兵，使空框中的删除键也能被识别；删除意图按按键前的状态判定，输入法组合期间的退格只影响手机候选串，组合结束后的短暂窗口内同样不发往 Mac。按 128 次退格／512 字节分片，顺序为先删后插。断线、切后台或未授权时手机文本域只读，重连后从空框开始，不重放断线期间的差异；手机不能读取 Mac 控件内容，协议也不提供该能力。

## 触控板手势与输入模式

0.8.0 沿用协议 v2：触控板长按 500 ms 对应一次 click/right/1，双指轻点右击继续保留；双击按住滑动对应一次普通左击及后续 drag 阶段，拖动释放逻辑共用。第二次按住候选不计时触发右击。

左右边缘滚动区仅发送 dx=0 的 scroll，使用已有 begin/update/end/cancel 阶段；中央双指滚动继续支持两个轴。区域在落指时锁定，混区加指取消当前手势。指针／拖动倍率、0.4 滚动基础系数、滚动倍率和自然方向均由客户端应用，服务端不重复乘倍率。

已移除遥控模式和速度积分；触控板／输入切换仍为客户端状态，不新增 mode 指令。切换、打开设置、后台或断线前清理拖动、滚动、长按计时器和待发更新。

## 心跳、恢复与限制

```json
{"type":"ping","v":2,"sessionID":"new-session-id","seq":11,"nonce":"browser-monotonic-clock"}
{"type":"pong","nonce":"browser-monotonic-clock"}
{"type":"status","permitted":false}
{"type":"disconnect","reason":"host_disconnect"}
```

约每 2 秒应用心跳，约 6 秒无有效消息断线，服务端按 1 秒节拍检查，可能存在一个节拍延后；原生 WS ping 不替代应用心跳。RTT 使用同一端单调时钟，不宣称单向延迟。

host_paused／host_stopped／timeout／congested／网络失败自动退避重连；host_disconnect、version、protocol 停止本轮自动重试。页面隐藏释放连接，返回后若不是显式断开则重连。权限变化保留连接但停止输入、清理按下状态。

SwiftNIO 负责 RFC6455 掩码与分片聚合（≤64 片段，≤16 KiB），无额外 TCP 长度头。应用 ≤240 消息／秒，原始帧 ≤480／秒。拒绝未知类型、旧会话、重复序号、非法数字、错乱阶段、过大消息；错误关闭且清理会话。客户端按帧累加更新；点击和阶段结束前 flush，拥塞取消而不堆积旧输入。

[共享样例](fixtures/messages.json) 含 52 组接受／拒绝序列，由 Swift 验证器和 Python 回环集成测试共同执行；覆盖退格、回车、实时 edit、重复序号、活动手势互斥和拒绝任意按键类型。test-session 与示例 epoch 是占位符。样例逐场景使用独立请求编号，专门的去重测试才复用 ID。
