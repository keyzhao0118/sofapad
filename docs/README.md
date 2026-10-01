# 文档索引

**唯一产品基线：[统一产品文档 v2.7](product-blueprint.md)**。当前开发版本 0.9.10；原始 MVP 稿的版本号 v0.2 与统一文档版本分别记录。

| 文档 | 职责 |
| --- | --- |
| [product-blueprint.md](product-blueprint.md) | 产品范围、页面、手势、文本行为、验收标准 |
| [decisions.md](decisions.md) | 可行性判断、冲突处理和代码对应关系 |
| [installation.md](installation.md) | **安装与使用教程**：安装、授权、连接、手势、输入、设置、排障、更新与卸载，附构建／测试／打包 |
| [协议 v2](../Protocol/README.md) | 消息格式、去重和状态约束 |
| [keyboard-interaction.md](keyboard-interaction.md) | 单手键盘入口、动效设计与本轮截图审查 |
| [validation.md](validation.md) | 实际测试结果与真机待测项 |
| [roadmap.md](roadmap.md) | 从未完成项继续的开发安排 |
| [中文产品介绍页](https://keyzhao0118.github.io/sofapad/) | 场景、功能、安装连接、手势、输入、设置与下载 |
| [releasing.md](releasing.md) | GitHub Release、安装包校验和 Pages 维护 |
| [third-party-notices.md](third-party-notices.md) | 依赖版本、许可证与致谢 |

需求来源完整保留于 [原始 MVP v0.2](archive/mvp-v0.2-original.md) 和 [旧蓝图 v1.3](archive/v0.1/product-blueprint.md)。[旧评估](archive/v0.1/decisions.md)、[旧测试记录](archive/v0.1/validation.md)仅说明历史，不与当前文档并行生效。

既有触控能力继续纳入 v2.7：移除遥控模式、引擎和设置，保留整屏触控板与文字输入。触控板恢复 500 ms 长按右击，双指右击、双指滚动、三指与双击按住拖动继续保留；左右各 28 px 窄区落指即纵向滚动，外侧 48 px 渐隐带内按方向判定滚动或指针，边缘柔和渐隐。

左上角为手感设置；实时输入使用手机键盘删除键，旧主机回退才显示左上角 Mac 退格按钮；当前采用右上角键盘按钮，点击呼出；同一位置显示收起箭头，输入条固定在顶部，不随键盘高度上下移动。滚动基础系数继续为 0.4，已有手感保留；控制界面屏蔽选中，文本框仍可选字。原文件 [Mac网页遥控器-产品稿.md](Mac网页遥控器-产品稿.md) 保留为入口，避免并行基线。

0.8.0：去掉配对、二维码、Cookie 与 HTTPS，改为“启动即服务、同网段浏览器打开菜单栏地址即可控制”；输入模式改为覆盖在触控板上的面板（2026-09-20 调整为底部展开），输入框“穿堂”式实时同步（字符提交即离开框内、向上飘出淡出，删除显示 ⌫、回车显示 ↵ 且发送真正的 Return 按键，断线不重放），旧主机回退整段粘贴；语音听写停顿即发送。所有设置与操作都在菜单栏菜单里（无独立设置窗口、无配对窗口），启动时若缺少辅助功能权限会主动弹出系统提示。产品边界同步在 [统一产品文档](product-blueprint.md) 第 7 节，实测记录见 [验证记录](validation.md)。

0.9.x：允许任意多台设备同时控制（每个连接独立会话与序号，会话级 busy 取消，同时手势以先开始者为准，菜单显示控制者数量并可断开单个或全部）；打包脚本不再把已移除依赖的遗留资源包拷进 App。详见 [验证记录](validation.md) 的 0.9.x 一节。
