using System.Diagnostics;
using Microsoft.Win32;
using SofaPad.Core;
using SofaPad.Input.Windows;
using SofaPad.Server;

namespace SofaPad.Windows;

internal sealed class TrayContext : ApplicationContext
{
    private readonly Control dispatch = new();
    private readonly NotifyIcon tray;
    private readonly ContextMenuStrip menu = new();
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 3000 };
    private readonly ClipboardWorker clipboard = new();
    private readonly ControlState state;
    private readonly EventWaitHandle shutdown;
    private LocalServer? server;
    private NetworkAddress[] addresses = [];
    private string? selected, bound;
    private bool stopped, locked, sleeping, changing, quitting;
    private string status = "正在启动…";
    private readonly string version = typeof(Program).Assembly.GetName().Version?.ToString(3) ?? "0.10.0";
    private string? lastFailure;
    private static string AdapterFile => Path.Combine(Program.DataDirectory, "adapter.txt");
    public TrayContext(EventWaitHandle shutdown)
    {
        this.shutdown = shutdown;
        _ = dispatch.Handle;
        state = new(new(new WindowsInputBackend(new Win32InputApi(), clipboard.Write)), Environment.MachineName,
            store: new JsonSettingsStore(Path.Combine(Program.DataDirectory, "settings.json"), Program.Log));
        try { if (File.Exists(AdapterFile)) selected = File.ReadAllText(AdapterFile); } catch (IOException) { }
        using var iconStream = typeof(Program).Assembly.GetManifestResourceStream("SofaPad.AppIcon.ico")!;
        tray = new NotifyIcon { Icon = new Icon(iconStream), Text = "SofaPad", ContextMenuStrip = menu, Visible = true };
        tray.DoubleClick += (_, _) => ShowConnection();
        menu.Opening += (_, _) => RefreshMenu();
        timer.Tick += async (_, _) => { if (shutdown.WaitOne(0)) await QuitAsync(); else await RefreshAsync(); };
        SystemEvents.SessionSwitch += OnSession;
        SystemEvents.PowerModeChanged += OnPower;
        SystemEvents.SessionEnding += OnEnding;
        timer.Start();
        _ = RefreshAsync();
        tray.ShowBalloonTip(10000, "SofaPad 已启动", "点击托盘图标查看手机连接地址。手机与电脑需连接同一个 Wi-Fi。", ToolTipIcon.Info);
    }
    private void Ui(Action action) { if (!quitting && !dispatch.IsDisposed) dispatch.BeginInvoke(action); }
    private void OnSession(object sender, SessionSwitchEventArgs e)
    {
        if (e.Reason is SessionSwitchReason.SessionLock or SessionSwitchReason.ConsoleDisconnect or SessionSwitchReason.RemoteDisconnect)
        { state.Suspend(true); Ui(() => { locked = true; _ = RefreshAsync(); }); }
        else if (e.Reason is SessionSwitchReason.SessionUnlock or SessionSwitchReason.ConsoleConnect or SessionSwitchReason.RemoteConnect)
            Ui(() => { locked = false; _ = RefreshAsync(); });
    }
    private void OnPower(object sender, PowerModeChangedEventArgs e)
    {
        if (e.Mode == PowerModes.Suspend) { state.Suspend(true); Ui(() => { sleeping = true; _ = RefreshAsync(); }); }
        if (e.Mode == PowerModes.Resume) Ui(() => { sleeping = false; _ = RefreshAsync(); });
    }
    private void OnEnding(object sender, SessionEndingEventArgs e) { state.Suspend(true); Ui(() => _ = QuitAsync()); }
    private async Task RefreshAsync()
    {
        if (changing || quitting) return;
        changing = true;
        try
        {
            addresses = NetworkAddress.Find();
            var chosen = addresses.FirstOrDefault(a => a.Adapter == selected) ?? addresses.FirstOrDefault(a => a.Priority < 100);
            var desired = !stopped && !locked && !sleeping ? chosen?.Address : null;
            if (bound != desired || (desired is not null && server is null))
            {
                state.Suspend(true);
                if (server is not null) { await server.DisposeAsync(); server = null; }
                bound = null;
                if (desired is not null)
                {
                    var candidate = new LocalServer(state);
                    try { await candidate.StartAsync(desired, 9876, Program.WebRoot); server = candidate; bound = desired; lastFailure = null; }
                    catch (Exception e) when (e is IOException or System.Net.Sockets.SocketException or InvalidOperationException)
                    {
                        await candidate.DisposeAsync();
                        status = "启动失败：端口 9876 被占用或网络不可用";
                        if (lastFailure != e.Message) { lastFailure = e.Message; Program.Log(e.Message); tray.ShowBalloonTip(6000, "SofaPad", status, ToolTipIcon.Warning); }
                        return;
                    }
                }
            }
            state.Suspend(quitting || stopped || locked || sleeping || server is null);
            var snapshot = state.Snapshot();
            status = stopped ? "服务已停止" : locked || sleeping ? "电脑已锁屏或休眠" : server is null ? "等待 Wi-Fi / 以太网私有 IPv4 地址" : $"服务已开启 · {snapshot.Controllers.Length} 台设备";
            tray.Text = "SofaPad · " + status;
        }
        catch (Exception e) { Program.Log(e.GetType().Name + ": " + e.Message); status = "网络检查失败，稍后自动重试"; }
        finally { changing = false; }
    }
    private void RefreshMenu()
    {
        menu.Items.Clear();
        menu.Items.Add("SofaPad " + version, null, (_, _) => ShowConnection());
        menu.Items.Add(new ToolStripMenuItem(status) { Enabled = false });
        var url = server?.Url;
        menu.Items.Add(new ToolStripMenuItem(url ?? "暂无连接地址") { Enabled = false });
        menu.Items.Add(new ToolStripMenuItem("复制连接地址", null, (_, _) => { if (url is not null) Copy(url); }) { Enabled = url is not null });
        menu.Items.Add("连接手机 / 使用帮助…", null, (_, _) => ShowConnection());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(stopped ? "开启服务" : "停止服务", null, async (_, _) => { stopped = !stopped; if (stopped) state.Suspend(true); await RefreshAsync(); });
        var controllers = new ToolStripMenuItem("已连接设备");
        foreach (var controller in state.Snapshot().Controllers)
            controllers.DropDownItems.Add("断开 " + controller.Label, null, (_, _) => state.Disconnect(controller.Id));
        controllers.Enabled = controllers.DropDownItems.Count > 0;
        menu.Items.Add(controllers);
        menu.Items.Add("断开全部设备", null, (_, _) => state.Disconnect());
        if (addresses.Length > 1)
        {
            var networks = new ToolStripMenuItem("网络地址");
            foreach (var address in addresses)
            {
                var item = new ToolStripMenuItem(address.Label) { Checked = bound == address.Address };
                item.Click += async (_, _) =>
                {
                    selected = address.Adapter;
                    try { Directory.CreateDirectory(Program.DataDirectory); File.WriteAllText(AdapterFile, selected); }
                    catch (Exception e) when (e is IOException or UnauthorizedAccessException) { Program.Log("网络偏好保存失败"); }
                    await RefreshAsync();
                };
                networks.DropDownItems.Add(item);
            }
            menu.Items.Add(networks);
        }
        menu.Items.Add(new ToolStripSeparator());
        var startup = new ToolStripMenuItem("登录时启动") { Checked = StartupEnabled() };
        startup.Click += (_, _) =>
        {
            try
            {
                using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
                if (StartupEnabled()) key.DeleteValue("SofaPad", false); else key.SetValue("SofaPad", '"' + Environment.ProcessPath! + '"');
            }
            catch (Exception e) when (e is UnauthorizedAccessException or System.Security.SecurityException or IOException)
            { MessageBox.Show("无法更改登录启动设置：" + e.Message, "SofaPad"); }
        };
        menu.Items.Add(startup);
        menu.Items.Add("打开设置与诊断目录", null, (_, _) => { Directory.CreateDirectory(Program.DataDirectory); Process.Start(new ProcessStartInfo(Program.DataDirectory) { UseShellExecute = true }); });
        menu.Items.Add("退出 SofaPad", null, async (_, _) => await QuitAsync());
    }
    private static bool StartupEnabled()
    { using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"); return key?.GetValue("SofaPad") is string; }
    private static void Copy(string value)
    { try { Clipboard.SetText(value); } catch (System.Runtime.InteropServices.ExternalException) { MessageBox.Show("剪贴板正忙，请稍后重试。", "SofaPad"); } }
    private void ShowConnection()
    {
        using var dialog = new Form { Text = "连接手机 · SofaPad", ClientSize = new(540, 410), StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false, AutoScaleMode = AutoScaleMode.Dpi };
        var heading = new Label { Text = "把手机变成电脑的触控板", Font = new Font("Microsoft YaHei UI", 16, FontStyle.Bold), AutoSize = true, Location = new(24, 24) };
        var instructions = new Label { Text = "1. 手机和电脑连接同一个 Wi-Fi。\n2. 在手机浏览器输入下方地址。\n3. 单指移动，双指滚动；右上角打开键盘。", AutoSize = true, Location = new(24, 76), Font = new Font("Microsoft YaHei UI", 10) };
        var address = new TextBox { Text = server?.Url ?? status, ReadOnly = true, Location = new(24, 168), Width = 370, Font = new Font("Segoe UI", 13) };
        var copy = new Button { Text = "复制", Location = new(410, 166), Size = new(100, 36), Enabled = server is not null };
        copy.Click += (_, _) => Copy(address.Text);
        var help = new Label { Location = new(24, 222), Size = new(490, 130), Text = "连接不上？\n确认服务已开启、手机未使用访客 Wi-Fi，并在 Windows 网络设置中将家庭网络设为“专用”。安装程序只为专用网络添加防火墙规则。\n\n仅用于可信局域网：打开地址即可控制。锁屏、UAC 和管理员窗口不接受控制。", Font = new Font("Microsoft YaHei UI", 9) };
        var close = new Button { Text = "知道了", Location = new(410, 365), Size = new(100, 32), DialogResult = DialogResult.OK };
        dialog.Controls.AddRange([heading, instructions, address, copy, help, close]); dialog.AcceptButton = close; dialog.CancelButton = close;
        dialog.ShowDialog();
    }
    private async Task QuitAsync()
    {
        if (quitting) return;
        quitting = true; timer.Stop(); state.Suspend(true);
        while (changing) await Task.Delay(25);
        if (server is not null) { await server.DisposeAsync(); server = null; }
        tray.Visible = false; ExitThread();
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            SystemEvents.SessionSwitch -= OnSession; SystemEvents.PowerModeChanged -= OnPower; SystemEvents.SessionEnding -= OnEnding;
            state.Suspend(true); tray.Dispose(); menu.Dispose(); timer.Dispose(); dispatch.Dispose(); clipboard.Dispose();
        }
        base.Dispose(disposing);
    }
}
