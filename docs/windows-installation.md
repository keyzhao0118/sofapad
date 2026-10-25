# SofaPad Windows 安装与使用

Windows 开发预览 0.10.0，适用于 Windows 11 x64 的普通、已解锁桌面。

**[下载 Windows 安装包 EXE](https://github.com/keyzhao0118/sofapad/releases/download/v0.10.0/SofaPad-0.10.0-windows-x64-setup.exe)** · [备用便携 ZIP](https://github.com/keyzhao0118/sofapad/releases/download/v0.10.0/SofaPad-0.10.0-windows-x64.zip) · [发布说明与校验文件](https://github.com/keyzhao0118/sofapad/releases/tag/v0.10.0)。Mac 用户请看 [Mac 教程](macos-installation.md)。

## 安装

双击 `SofaPad-0.10.0-windows-x64-setup.exe`，按安装向导完成。安装需要管理员授权，以便写入 Program Files 并添加防火墙规则；SofaPad 本身以普通用户权限运行。无需另外安装 .NET、Node.js 或 Python。安装程序尚未代码签名，Windows 可能显示未知发布者，请先核对下载来源与 SHA-256。

打开开始菜单里的 SofaPad。程序没有常驻主窗口，图标位于任务栏通知区域（可能在向上箭头展开的区域）。双击图标可查看连接说明；右键菜单可以复制地址、开关服务、选择网卡、断开设备和设置登录启动。

如果 Windows 显示“Windows 已保护你的电脑”，请先确认文件来自上述 GitHub Release，再查看“更多信息”中的“仍要运行”（如系统提供）。单位电脑的策略限制请联系管理员；不要关闭整个防火墙或系统保护。

1. 手机和电脑连接同一个家庭 Wi-Fi。
2. 将 Windows 当前家庭网络配置设为“专用网络”。安装程序只允许专用网络、同一子网连接本应用的 TCP 9876 端口。
3. 在手机浏览器输入托盘显示的 `http://192.168.x.x:9876/` 地址，进入触控板。

请使用自己电脑显示的实际地址，不要照抄示例，也不要把 GitHub Pages 当作控制入口。看到“可以开始操作”后滑动一下，电脑指针随之移动就表示连接成功。随后先点中电脑输入框，再打开手机右上角键盘输入中文。

ZIP 是便携版，必须解压整个文件夹再打开 SofaPad.exe。便携版不自动创建防火墙规则，推荐日常使用安装版。

## 操作

- 单指移动、轻点、双击；双指轻点右击、双指上下左右滚动。
- 长按约半秒右击；三指拖动；轻点一次后第二次按住并移动也可拖动。
- 左右边缘窄条单指上下滚动。
- 左上角设置指针、滚动速度、自然滚动及手机常亮；设置保存在当前电脑，连接的手机同步。
- 右上角打开键盘。先将电脑光标置于目标输入框，再用手机输入中文、英文或 Emoji；删除和回车立即发送到当前焦点。
- 多设备可以连接。一个设备拖动或滚动期间，其他设备的冲突动作被忽略。

## 排障

| 现象 | 检查 |
| --- | --- |
| 没有地址 | 电脑需有活动 Wi-Fi / 以太网私有 IPv4（10.x、172.16–31.x、192.168.x）。多网卡可在托盘菜单选择。 |
| 启动失败 | 9876 端口可能被其他程序占用；检查托盘状态与诊断目录。 |
| 手机打不开 | 同一 Wi-Fi、网络为专用、未使用访客网络或 AP 隔离；确认安装时防火墙规则成功添加。不要关闭整个防火墙。 |
| 网页能打开但窗口无法控制 | 回到已解锁普通桌面。管理员程序、UAC 安全桌面、锁屏不能控制；不要以管理员运行 SofaPad。 |
| 文字没到目标 | 电脑焦点必须在输入框。部分游戏、终端或自定义控件可能不接受 Unicode 合成输入；本程序不读取输入框、不抢焦点。 |
| 滚动较慢 | 手机设置可调整滚动速度。Windows 轮滚设置和目标应用决定细小滚轮增量的实际响应。 |

配置在 `%LOCALAPPDATA%\SofaPad\settings.json`，诊断在同目录 `diagnostics.log`。日志不记录输入文本、剪贴板或控制消息。普通输入不经过剪贴板，旧版网页的整段粘贴回退会写入系统剪贴板并保留该内容。

## 更新与卸载

运行新版安装程序覆盖升级，保留当前用户设置。安装器会请求已运行的 SofaPad 退出，并等待输入释放与服务关闭；如果等待超时，请从托盘退出后重试安装。卸载通过 Windows“设置 → 应用 → 已安装的应用 → SofaPad”；移除程序、快捷方式和本应用的防火墙规则，保留用户设置，方便重新安装。需要彻底清除偏好时，可在退出后删除 `%LOCALAPPDATA%\SofaPad`。

明文局域网 HTTP/WS，无账号或配对。同一网络中的设备打开地址即可控制，只用于可信家庭网络。没有公网穿透、屏幕镜像、远程开机或解锁。

## 从源码构建

安装 .NET SDK 10.0.402（同补丁系列可向前更新）、Node.js 22+、pnpm、Python 3，打包另需 Inno Setup 6。SDK 版本由 `WindowsApp/global.json` 锁定。Windows 端不依赖第三方 NuGet 包。

```powershell
./scripts/build-windows.ps1
./scripts/test-windows.ps1
./scripts/test-windows.ps1 -Desktop   # 会打开隔离验证窗口并短暂移动鼠标
./scripts/package-windows.ps1
```

安装包、ZIP 和校验值在 `build/releases/`。`-DotNet` 可指定 SDK 路径。开发预览入口 `SofaPad.exe --preview-server --port 9876 --web-root <Web/dist> --info-file <json>` 仅绑定 127.0.0.1，不注入系统输入、不读取用户设置。

自动测试、真实输入和隔离环境安装验证已通过；手机、多屏及实际登录启动仍待验收，见 [Windows 验证记录](windows-validation.md)。
