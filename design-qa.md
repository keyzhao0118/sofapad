# SofaPad 键盘把手设计验收

日期：2026-09-20

## 对照来源与范围

- source visual truth: `/Users/keyzhao/.codex/generated_images/01a081d3-b533-72f0-86e1-d836e41da84f/exec-bfe35d69-f6ea-464e-bc1e-26e087c6d8a7.png`（用户选择的第 1 张）
- implementation screenshot: `build/keyboard-design/trackpad.png`
- viewport: 393 × 852 CSS px；state: 已连接、触控板、键盘关闭。
- 原图 851 × 1847 px，按视口归一到 393 × 852；实现截图 393 × 852 px（1×）。原图长宽比的亚像素差异不作为布局缺陷。
- full-view comparison: `build/keyboard-design/comparison.png`，左原图、右实现。
- focused region comparison: `build/keyboard-design/comparison-handle.png`，底部入口区域。

## Findings

无尚待修复的 P0/P1/P2 视觉问题。

- 字体：沿用系统字体和 PingFang SC；关闭态无新增可见文案。输入提示保持 12 px，输入文字 18 px。
- 间距与布局：设置入口保留左上角，右上角空出；键盘入口居中、104 × 48 px，底部间距 32 px。原图归一后的把手略小，采用已约定的触摸尺寸，视为有意的可用性调整。
- 色彩：保留 #e8eade 底色、浅色胶囊、灰绿图标与左右自然渐隐滚动区；生成稿的光照、纹理不作为新的背景资产，沿用产品已有点阵。
- 资产：复用项目原有设置、键盘矢量图标；收起使用 Heroicons chevron-down，MIT 许可随 HTML 分发。原图键盘按键略多，遵循产品少线条要求保留现有图标。
- 内容：不新增说明文字占用触控区。预览截图底部“演示模式”是预览执行器的标识，正式服务隐藏，属于已知的环境差异。

## 交互与响应式证据

- `build/keyboard-design/input.png`：393 × 852 输入态。
- `build/keyboard-design/input-compact.png`：393 × 330，模拟键盘压缩后的可见区域；文本框、同步提示、48 px 收起把手均在可见区域。
- `build/keyboard-design/input-landscape.png`：852 × 393 横屏输入态。
- 浏览器验证：展开立即聚焦 textarea；输入提交恢复空缓冲；箭头关闭、空白区域关闭、失焦后恢复触控板；设置打开／关闭正常。检查到的 warning/error 日志为空。
- 自动化：TypeScript 编译与 67 项前端测试通过；完整 Chromium 回归脚本仅更新，本轮未执行。
- 真机边界：内置桌面浏览器不能验证 iPhone 系统键盘。iOS 原生键盘、IME、听写及安全区域需真机复核，不纳入本次桌面视觉通过结论。

## Comparison History

首次同状态全图与局部对照未发现 P0/P1/P2 问题，无视觉修复循环。短视口初次截图捕获到视口切换期间的缩放帧，已等待布局稳定后重拍并检查 393 × 330 实际截图。

## Implementation Checklist

- [x] 底部居中键盘入口与同步 focus。
- [x] 输入面板随可见视口上移，显示收起图标。
- [x] 保留空白区域与失焦收起，不新增冲突手势。
- [x] 文档、教程截图、回归断言同步。
- [ ] iPhone Safari 真机键盘与输入法验收。

final result: passed
