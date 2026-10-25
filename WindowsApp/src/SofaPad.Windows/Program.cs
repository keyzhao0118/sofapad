using System.Security.Principal;
using SofaPad.Core;
using SofaPad.Server;

namespace SofaPad.Windows;

internal static class Program
{
    internal static readonly string DataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SofaPad");
    internal static readonly string WebRoot = Path.Combine(AppContext.BaseDirectory, "Web");
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        if (args.Contains("--preview-server")) return RunPreview(args).GetAwaiter().GetResult();
        var sid = WindowsIdentity.GetCurrent().User!.Value;
        var instanceName = @"Local\SofaPad." + sid;
        using var shutdown = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\SofaPad.Shutdown." + sid);
        if (args.Contains("--shutdown")) return InstanceShutdown.Request(shutdown, instanceName, TimeSpan.FromSeconds(15)) ? 0 : 2;
        if (args.Contains("--uninstall-user"))
        {
            using var run = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
            run?.DeleteValue("SofaPad", false);
            return InstanceShutdown.Request(shutdown, instanceName, TimeSpan.FromSeconds(15)) ? 0 : 2;
        }
        using var singleton = new Mutex(true, instanceName, out var first);
        if (!first) { MessageBox.Show("SofaPad 已在运行，请点击任务栏通知区域的图标。", "SofaPad"); return 0; }
        if (new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
        { MessageBox.Show("请以普通用户身份打开 SofaPad。局域网控制服务不应以管理员权限运行。", "SofaPad"); return 1; }
        try
        {
            using var context = new TrayContext(shutdown);
            Application.Run(context); return 0;
        }
        catch (Exception e)
        { Log(e.GetType().Name + ": " + e.Message); MessageBox.Show("SofaPad 未能启动。\n" + e.Message, "SofaPad"); return 1; }
        finally { singleton.ReleaseMutex(); }
    }
    internal static void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(DataDirectory);
            var path = Path.Combine(DataDirectory, "diagnostics.log");
            if (File.Exists(path) && new FileInfo(path).Length > 262144) File.Move(path, path + ".old", true);
            File.AppendAllText(path, $"{DateTimeOffset.Now:O} {message}\n");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }
    private static async Task<int> RunPreview(string[] args)
    {
        string? Option(string key) { var i = Array.IndexOf(args, key); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
        var port = int.Parse(Option("--port") ?? "9876");
        var state = new ControlState(new(new PreviewBackend()), "SofaPad Windows Preview", true);
        await using var server = new LocalServer(state);
        try
        {
            await server.StartAsync("127.0.0.1", port, Option("--web-root") ?? WebRoot);
            if (Option("--info-file") is { } path) await File.WriteAllBytesAsync(path, Wire.Encode(new { url = server.Url }));
            await Task.Delay(Timeout.Infinite); return 0;
        }
        catch (Exception e) { Log("Preview: " + e.GetType().Name + ": " + e.Message); return 1; }
    }
}
