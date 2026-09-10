# SofaPad protocol v2

协议随 App／网页一起更新，v1 页面需要刷新。产品行为以 [统一文档](../docs/product-blueprint.md) 为准，JSON 结构见 [schema/input-v2.json](schema/input-v2.json)；旧 schema 仅留在 archive/。

HTTPS 页面和 WSS 共用端口；HTTP/WS 仅为显式开发模式。浏览器 POST `/api/pair` 获取 HttpOnly／SameSite=Strict Cookie，HTTPS 另带 Secure 并使用 __Host-sofapad 名称（HTTP 用 sofapad）。GET `/api/status` 检查配对／版本；同源 `/ws` 开始控制。POST `/api/forget` 撤销当前凭据，手机不再提供常驻忘记按钮，Mac 可管理配对。

## 握手与会话

```json
{"type":"hello","v":2}
{"type":"ready","v":2,"sessionID":"new-session-id","pasteEpoch":"11111111-2222-3333-4444-555555555555","name":"Mac","permitted":true,"doubleClickInterval":0.5,"preview":false}
```

3 秒内 hello；每条输入、ping、disconnect 均包含 v=2、当前 sessionID、从 1 开始严格递增的 seq（最大 9007199254740991）。每次 socket 使用新 sessionID，旧动作不重放。只有一个活动会话，第二浏览器／标签页返回 busy，不抢占。

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

scroll 和 drag 各自严格 begin → update* → end/cancel，结束 dx=dy=0，两者互斥。任何活动拖动／滚动期间拒绝 move、click、paste。drag begin 在当前位置发送 leftMouseDown 后 leftMouseDragged，end/cancel 或会话清理释放。协议 scroll 阶段不等于模拟 Quartz 惯性或手势阶段。

## 文本与回执

```json
{"type":"paste","v":2,"sessionID":"new-session-id","seq":9,"requestID":"11111111-2222-3333-4444-555555555555:00112233445566778899aabbccddeeff","text":"  中文 👩🏽‍💻\n下一行\n"}
{"type":"pasteResult","requestID":"11111111-2222-3333-4444-555555555555:00112233445566778899aabbccddeeff","status":"executed","duplicate":false}
```

requestID 由当前进程 pasteEpoch、冒号、128-bit 随机值组成。协议限制 ASCII 字母／数字／冒号／连字符，共 38～100 字节，并检查 epoch 前缀。text 非空、≤12,000 UTF-8 字节；完整 JSON ≤16,384 字节，转义也占空间。不 trim、不规范化、不自动截断。

Mac 按设备保存 requestID → 文本 SHA-256 摘要与结果。跨 socket 重连仍生效；同 ID 同内容回原结果且 duplicate=true，同 ID 不同内容回 id_conflict，不重复执行。失败结果也保留，每设备上限 1024，不移除旧 ID 腾空间；满额回 limit。重启进程换 epoch，旧编号回 expired。停止／开启服务不重置进程 epoch。撤销设备即失去鉴权，并清理其结果表。

| status | 含义 |
| --- | --- |
| executed | 剪贴板写入成功，粘贴事件已投递；不保证目标应用接受 |
| clipboard_failed | 剪贴板写失败，没有发送粘贴快捷键 |
| permission | 辅助功能权限不可用或主机暂停 |
| unavailable | 无法生成粘贴事件；剪贴板可能已更新 |
| busy | 执行器仍在拖动；正常协议应先结束拖动 |
| expired | 会话／凭据／epoch 失效，未执行 |
| id_conflict | 同一 ID 已用于不同文本，未再次执行 |
| limit | 结果表达到上限，未执行新请求 |

手机一次只保留一个未决提交；回执按 ID 匹配，6 秒未获结果或已发送后断线，显示“请查看电视确认是否已粘贴”，不自动重试。未发送则提示尚未发送，不存离线队列。客户端本地还使用 not_sent、too_large、uncertain 表示这些状态。新一次主动点击才生成新 ID。

## 心跳、恢复与限制

```json
{"type":"ping","v":2,"sessionID":"new-session-id","seq":10,"nonce":"browser-monotonic-clock"}
{"type":"pong","nonce":"browser-monotonic-clock"}
{"type":"status","permitted":false}
{"type":"disconnect","reason":"host_disconnect"}
```

约每 2 秒应用心跳，约 6 秒无有效消息断线，服务端按 1 秒节拍检查，可能存在一个节拍延后；原生 WS ping 不替代应用心跳。RTT 使用同一端单调时钟，不宣称单向延迟。

host_paused／host_stopped／timeout／congested／网络失败自动退避重连；busy、revoked、unpaired、host_disconnect、version、protocol 停止本轮自动重试。页面隐藏释放连接，返回后若不是显式断开则重连。权限变化保留连接但停止输入、清理按下状态。

SwiftNIO 负责 RFC6455 掩码与分片聚合（≤64 片段，≤16 KiB），无额外 TCP 长度头。应用 ≤240 消息／秒，原始帧 ≤480／秒。拒绝未知类型、旧会话、重复序号、非法数字、错乱阶段、过大消息；错误关闭且清理会话。客户端按帧累加更新；点击和阶段结束前 flush，拥塞取消而不堆积旧输入。

[共享样例](fixtures/messages.json) 含 35 组接受／拒绝序列，由 Swift 验证器和 Python HTTP/WSS 集成测试共同执行；test-session 与示例 epoch 是占位符。样例逐场景使用独立请求编号，专门的去重测试才复用 ID。
