using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text.Json;
using System.Runtime.InteropServices;
using SofaPad.Core;
using SofaPad.Input.Windows;
using SofaPad.Server;

namespace SofaPad.DesktopProbe;

internal static class Program
{
    private static int failures;
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [STAThread]
    private static int Main()
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        using var form = new Form { Text = "SofaPad · Windows 输入验证", Size = new(700, 430), StartPosition = FormStartPosition.CenterScreen, TopMost = true };
        var field = new TextBox { Multiline = true, AcceptsReturn = true, Location = new(25, 25), Size = new(630, 140), Font = new Font("Microsoft YaHei UI", 14) };
        var surface = new ProbePanel { Location = new(25, 190), Size = new(630, 160), BackColor = Color.LightGray };
        form.Controls.AddRange([field, surface]);
        var start = new Button { Text = "开始验证", Location = new(540, 360), Size = new(110, 30) };
        form.Controls.Add(start);
        if (Environment.GetEnvironmentVariable("SOFAPAD_PROBE_MANUAL") != "1") form.Shown += (_, _) => start.PerformClick();
        start.Click += async (_, _) =>
        {
            start.Enabled = false;
            var api = new Win32InputApi(); var original = api.Position;
            var backend = new WindowsInputBackend(api, text => (bool)form.Invoke(() => { Clipboard.SetText(text); return true; }));
            var state = new ControlState(new(backend), "Desktop probe");
            using var portProbe = new TcpListener(IPAddress.Loopback, 0); portProbe.Start();
            var port = ((IPEndPoint)portProbe.LocalEndpoint).Port; portProbe.Stop();
            await using var server = new LocalServer(state);
            try
            {
                var root = Environment.GetEnvironmentVariable("SOFAPAD_WEB_ROOT") ?? Path.GetFullPath("Web/dist");
                await server.StartAsync("127.0.0.1", port, root);
                await Task.Run(async () =>
                {
                    void Assert(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS native " + name); }
                    using var ws = new ClientWebSocket(); ws.Options.Proxy = null; ws.Options.SetRequestHeader("Origin", $"http://127.0.0.1:{port}");
                    await ws.ConnectAsync(new Uri($"ws://127.0.0.1:{port}/ws"), CancellationToken.None);
                    await ws.SendAsync(Wire.Encode(new { type = "hello", v = 2 }), WebSocketMessageType.Text, true, CancellationToken.None);
                    var buf = new byte[16384]; var reply = await ws.ReceiveAsync(buf, CancellationToken.None);
                    using var ready = JsonDocument.Parse(buf.AsMemory(0, reply.Count)); var id = ready.RootElement.GetProperty("sessionID").GetString();
                    long seq = 0;
                    async Task Send(string type, object? extra = null)
                    {
                        var data = new Dictionary<string, object?> { ["v"] = 2, ["sessionID"] = id, ["seq"] = ++seq, ["type"] = type };
                        if (extra is not null) foreach (var p in JsonSerializer.SerializeToElement(extra).EnumerateObject()) data[p.Name] = p.Value;
                        await ws.SendAsync(Wire.Encode(data), WebSocketMessageType.Text, true, CancellationToken.None); await Task.Delay(100);
                    }
                    form.Invoke(() => { form.Activate(); field.Focus(); }); await Task.Delay(300);
                    Console.WriteLine($"Desktop available: {api.DesktopAvailable}; input focus: {form.Invoke(() => field.Focused)}");
                    var ownHandle = (IntPtr)form.Invoke(() => form.Handle);
                    Assert(GetForegroundWindow() == ownHandle, "probe owns foreground before injecting");
                    const string text = "你好 SofaPad 😀 é";
                    await Send("edit", new { text }); await Task.Delay(100);
                    await Send("ping", new { nonce = "native-check" });
                    reply = await ws.ReceiveAsync(buf, CancellationToken.None);
                    Console.WriteLine("After edit: " + System.Text.Encoding.UTF8.GetString(buf, 0, reply.Count));
                    var actualText = (string)form.Invoke(() => field.Text);
                    Console.WriteLine("Observed generated text: " + JsonSerializer.Serialize(actualText));
                    Assert(actualText == text, "Unicode Chinese / emoji / combining marks");
                    await Send("edit", new { text = "ab" }); await Send("backspace"); await Send("edit", new { delete = 1, text = "好" });
                    Assert((string)form.Invoke(() => field.Text) == text + "好", "edit / Backspace order");
                    await Send("enter"); await Send("edit", new { text = "第二行" });
                    Assert((string)form.Invoke(() => field.Text) == text + "好\r\n第二行", "real Enter in multiline field");
                    var pasteID = ready.RootElement.GetProperty("pasteEpoch").GetString() + ":desktop-test";
                    await Send("paste", new { requestID = pasteID, text = " 粘贴 " });
                    reply = await ws.ReceiveAsync(buf, CancellationToken.None);
                    Assert(JsonDocument.Parse(buf.AsMemory(0, reply.Count)).RootElement.GetProperty("status").GetString() == "executed", "clipboard acknowledgement");
                    Assert(((string)form.Invoke(() => field.Text)).EndsWith("第二行 粘贴 "), "Ctrl+V reaches focused field");
                    var target = (Point)form.Invoke(() => surface.PointToScreen(new Point(120, 70)));
                    var current = api.Position; await Send("move", new { dx = target.X - current.X, dy = target.Y - current.Y });
                    Assert(api.Position == target, "absolute physical-pixel movement");
                    await Send("click", new { button = "left", count = 1 }); await Send("click", new { button = "left", count = 2 });
                    Assert((int)form.Invoke(() => surface.LeftDowns) == 2 && (int)form.Invoke(() => surface.DoubleClicks) == 1, "two clicks form one double-click");
                    await Send("click", new { button = "right", count = 1 });
                    Assert((int)form.Invoke(() => surface.RightDowns) == 1, "right click");
                    await Send("scroll", new { phase = "begin", dx = 10, dy = -12 }); await Send("scroll", new { phase = "end", dx = 0, dy = 0 });
                    Assert((int)form.Invoke(() => surface.Vertical) == -12 && (int)form.Invoke(() => surface.Horizontal) == -10, "fine vertical and horizontal wheel deltas");
                    await Send("drag", new { phase = "begin", dx = 8, dy = 5 });
                    var ups = (int)form.Invoke(() => surface.LeftUps);
                    ws.Abort(); await Task.Delay(300);
                    Assert((int)form.Invoke(() => surface.LeftUps) == ups + 1, "disconnect releases real held mouse");
                });
                Console.WriteLine("Native desktop probe passed");
            }
            catch (Exception e) { failures++; Console.Error.WriteLine(e); if (Environment.GetEnvironmentVariable("SOFAPAD_PROBE_HOLD") == "1") await Task.Delay(30000); }
            finally
            {
                state.Disconnect(); var current = api.Position; backend.Move(original.X - current.X, original.Y - current.Y);
                form.Close();
            }
        };
        Application.Run(form); return failures == 0 ? 0 : 1;
    }
}
internal sealed class ProbePanel : Panel
{
    public int LeftDowns, LeftUps, RightDowns, DoubleClicks, Vertical, Horizontal;
    protected override void WndProc(ref Message m)
    {
        switch (m.Msg)
        {
            case 0x201: LeftDowns++; break;
            case 0x203: LeftDowns++; DoubleClicks++; break;
            case 0x202: LeftUps++; break;
            case 0x204: RightDowns++; break;
            case 0x20A: Vertical += (short)(m.WParam.ToInt64() >> 16); break;
            case 0x20E: Horizontal += (short)(m.WParam.ToInt64() >> 16); break;
        }
        base.WndProc(ref m);
    }
}
