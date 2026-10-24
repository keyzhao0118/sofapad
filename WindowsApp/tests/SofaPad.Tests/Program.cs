using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using SofaPad.Core;
using SofaPad.Input.Windows;

var passed = 0;
void Check(bool value, string message) { if (!value) throw new Exception(message); }
void Test(string name, Action action) { action(); passed++; Console.WriteLine("PASS " + name); }
void Reject(Action action) { try { action(); } catch (ProtocolException) { return; } throw new Exception("Expected rejection"); }
byte[] Message(string id, long seq, string type, object? extra = null)
{
    var value = new Dictionary<string, object?> { ["sessionID"] = id, ["seq"] = seq, ["type"] = type, ["v"] = 2 };
    if (extra is not null) foreach (var p in JsonSerializer.SerializeToElement(extra, Wire.Json).EnumerateObject()) value[p.Name] = p.Value;
    return Wire.Encode(value);
}
JsonElement Json(object value) => JsonSerializer.SerializeToElement(value, Wire.Json);

try
{
    using var fixtures = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "fixtures.json")));
    foreach (var fixture in fixtures.RootElement.EnumerateArray())
    {
        var f = fixture;
        Test("fixture: " + f.GetProperty("name").GetString(), () =>
        {
            var validator = new ProtocolValidator("test-session"); var accepted = true;
            try { foreach (var m in f.GetProperty("messages").EnumerateArray()) validator.Validate(Encoding.UTF8.GetBytes(m.GetString()!), 100); }
            catch (ProtocolException) { accepted = false; }
            Check(accepted == f.GetProperty("valid").GetBoolean(), "fixture verdict");
        });
    }
    Test("sequence is a JS-safe 64-bit integer", () =>
    {
        var validator = new ProtocolValidator("s");
        validator.Validate(Message("s", 3_000_000_000, "ping", new { nonce = "x" }), 1);
        validator.Validate(Message("s", 9_007_199_254_740_991, "ping", new { nonce = "x" }), 1);
        Reject(() => validator.Validate(Message("s", 9_007_199_254_740_992, "ping", new { nonce = "x" }), 1));
    });
    Test("rate and invalid UTF-8 limits", () =>
    {
        var v = new ProtocolValidator("s");
        for (var i = 1; i <= 240; i++) v.Validate(Message("s", i, "ping", new { nonce = "x" }), 1);
        Reject(() => v.Validate(Message("s", 241, "ping", new { nonce = "x" }), 1));
        v.Validate(Message("s", 242, "ping", new { nonce = "x" }), 2);
        Reject(() => v.Validate(new byte[] { 0xff }, 3));
    });
    Test("UTF-8 bytes, nonempty edit, boolean settings", () =>
    {
        Reject(() => new ProtocolValidator("s").Validate(Message("s", 1, "edit", new { text = new string('中', 1366) }), 1));
        Reject(() => new ProtocolValidator("s").Validate(Message("s", 1, "settings", new { settings = new { natural = 1 } }), 1));
        new ProtocolValidator("s").Validate(Message("s", 1, "edit", new { text = new string('中', 1365) }), 1);
    });
    Test("fractions, one click per message, double-click second click", () =>
    {
        var fake = new FakeBackend(); var input = new InputExecutor(fake);
        for (var i = 0; i < 4; i++) input.Execute(new("move", .3, -.3));
        Check(fake.Events.SequenceEqual(new[] { "move:1,-1" }), "fractional movement");
        input.Execute(new("click", Button: "left", Count: 1)); input.Execute(new("click", Button: "left", Count: 2));
        Check(fake.Events.Count(e => e == "left:True") == 2 && fake.Events.Count(e => e == "left:False") == 2, "not three clicks");
    });
    Test("wheel units accumulate independently, reverse and end without a jump", () =>
    {
        var fake = new FakeBackend(); var input = new InputExecutor(fake);
        input.Execute(new("scroll", .4, .4, "begin"));
        input.Execute(new("scroll", .7, .7, "update"));
        input.Execute(new("scroll", -1.3, -1.3, "update"));
        input.Execute(new("scroll", 0, 0, "end"));
        Check(fake.Events.SequenceEqual(new[] { "wheel:-1,1", "wheel:1,-1" }), "fine wheels, horizontal axis adaptation");
    });
    Test("edit deletes before exact text; clipboard failure never pastes", () =>
    {
        var fake = new FakeBackend(); var input = new InputExecutor(fake);
        input.Execute(new("edit", Text: " 中文 👩🏽‍💻\né ", Delete: 2));
        Check(fake.Events.SequenceEqual(new[] { "key:8", "key:8", "text: 中文 👩🏽‍💻\né " }), "exact text and ordering");
        fake.ClipboardOK = false; Check(input.Paste("value") == "clipboard_failed", "clipboard result");
        Check(!fake.Events.Contains("paste"), "no shortcut after clipboard failure");
        fake.Permitted = false; input.Reset(); Check(fake.Events.Last() == "release", "cleanup after permission loss");
    });
    Test("A drag survives B click, ignored drag end and disconnect; no mid-gesture takeover", () =>
    {
        var fake = new FakeBackend(); var state = new ControlState(new(fake), "test");
        var a = state.Acquire("A", _ => { }, _ => { }); var b = state.Acquire("B", _ => { }, _ => { });
        state.Process(Message(a, 1, "drag", new { phase = "begin", dx = 4, dy = 3 }), a);
        var before = fake.Events.Count;
        state.Process(Message(b, 1, "click", new { button = "left", count = 1 }), b);
        state.Process(Message(b, 2, "drag", new { phase = "begin", dx = 9, dy = 9 }), b);
        Check(fake.Events.Count == before, "B cannot disturb A");
        state.Process(Message(a, 2, "drag", new { phase = "end", dx = 0, dy = 0 }), a);
        before = fake.Events.Count;
        state.Process(Message(b, 3, "drag", new { phase = "update", dx = 9, dy = 9 }), b);
        state.Process(Message(b, 4, "drag", new { phase = "end", dx = 0, dy = 0 }), b);
        Check(fake.Events.Count == before, "ignored gesture stays ignored");
        state.Process(Message(a, 3, "drag", new { phase = "begin", dx = 2, dy = 1 }), a);
        before = fake.Events.Count; state.Release(b); Check(fake.Events.Count == before, "nonowner disconnect");
        state.Release(a); Check(fake.Events.Last() == "release", "owner disconnect releases");
    });
    Test("paste dedupe survives reconnect, hashes content, caches failure and limits receipts", () =>
    {
        var fake = new FakeBackend(); var state = new ControlState(new(fake), "test"); var replies = new List<JsonElement>();
        var a = state.Acquire("A", v => replies.Add(Json(v)), _ => { });
        var requestID = state.PasteEpoch + ":one";
        void Paste(string id, long seq, string request, string text) => state.Process(Message(id, seq, "paste", new { requestID = request, text }), id, 1);
        Paste(a, 1, requestID, "same"); state.Release(a);
        var b = state.Acquire("B", v => replies.Add(Json(v)), _ => { });
        Paste(b, 1, requestID, "same"); Check(replies.Last().GetProperty("duplicate").GetBoolean(), "duplicate");
        Check(fake.Events.Count(e => e == "paste") == 1, "exactly once");
        Paste(b, 2, requestID, "different"); Check(replies.Last().GetProperty("status").GetString() == "id_conflict", "conflict");
        Paste(b, 3, Guid.NewGuid() + ":old", "same"); Check(replies.Last().GetProperty("status").GetString() == "expired", "epoch");
        fake.ClipboardOK = false;
        for (var i = 1; i < 1024; i++)
            state.Process(Message(b, i + 3, "paste", new { requestID = state.PasteEpoch + ":" + i, text = "x" }), b, 10 + i / 100.0);
        fake.ClipboardOK = true;
        state.Process(Message(b, 1027, "paste", new { requestID = state.PasteEpoch + ":1", text = "x" }), b, 30);
        Check(replies.Last().GetProperty("status").GetString() == "clipboard_failed", "failure cached");
        state.Process(Message(b, 1028, "paste", new { requestID = state.PasteEpoch + ":overflow", text = "x" }), b, 31);
        Check(replies.Last().GetProperty("status").GetString() == "limit", "bounded receipts");
    });
    Test("settings atomically persist, merge, recover and never acknowledge failed saves", () =>
    {
        var folder = Path.Combine(Path.GetTempPath(), "sofapad-settings-" + Guid.NewGuid()); Directory.CreateDirectory(folder);
        try
        {
            var path = Path.Combine(folder, "settings.json"); var store = new JsonSettingsStore(path);
            store.Save(new(2.2, .8, false, false)); Check(store.Load() == new ControlSettings(2.2, .8, false, false), "restart");
            File.WriteAllText(path, "broken"); Check(store.Load() == new ControlSettings() && File.Exists(path + ".invalid"), "corrupt recovery");
            var failing = new MemoryStore(); var replies = new List<JsonElement>(); var state = new ControlState(new(new FakeBackend()), "test", store: failing);
            var a = state.Acquire("A", v => replies.Add(Json(v)), _ => { }); var b = state.Acquire("B", _ => { }, _ => { });
            state.Process(Message(a, 1, "settings", new { settings = new { pointer = 2.8 } }), a);
            state.Process(Message(b, 1, "settings", new { settings = new { scroll = .1 } }), b);
            Check(failing.Value.Pointer == 2.8 && failing.Value.Scroll == .1, "merge patches");
            failing.Fail = true;
            state.Process(Message(a, 2, "settings", new { settings = new { natural = false } }), a);
            Check(replies.Last().GetProperty("type").GetString() == "settingsError", "no false saved message");
            Check(Json(state.Ready(a)).GetProperty("settingsRevision").GetInt32() == 2, "failed saves retain revision");
        }
        finally { Directory.Delete(folder, true); }
    });
    Test("native INPUT layout, Unicode, partial delivery cleanup and physical modifiers", () =>
    {
        Check(Marshal.SizeOf<NativeEvent>() == (IntPtr.Size == 8 ? 40 : 28), "INPUT ABI");
        var api = new FakeApi(); var backend = new WindowsInputBackend(api, _ => true);
        backend.Text("中😀é");
        var down = api.Batches.Single().Where(e => e.Data.Keyboard.Flags == 4).Select(e => (char)e.Data.Keyboard.Scan);
        Check(new string(down.ToArray()) == "中😀é", "UTF-16 units");
        api.Batches.Clear(); api.NextDelivered = 1;
        try { backend.Key(0x08); throw new Exception("partial accepted"); } catch (InputException) { }
        Check(api.Batches.Count == 2 && api.Batches[1].Single().Data.Keyboard.Flags == 2, "partial down is released");
        api.PhysicalModifiersDown = true; Check(!backend.PasteShortcut(), "physical ctrl not borrowed");
        api.PhysicalModifiersDown = false; api.NextDelivered = 2;
        try { backend.PasteShortcut(); } catch (InputException) { }
        Check(api.Batches.Last().Length == 2 && api.Batches.Last().All(e => e.Data.Keyboard.Flags == 2), "partial Ctrl+V cleanup");
    });
    Test("absolute movement handles negative coordinates and monitor gaps", () =>
    {
        var displays = new[] { new Rectangle(-1920, 0, 1920, 1080), new Rectangle(0, 300, 2560, 1440) };
        Check(WindowsInputBackend.ClampToDisplays(new(-10, 1500), displays) == new Point(0, 1500), "nearest physical display");
        var api = new FakeApi { Position = new(-1000, 200), Displays = displays, Desktop = new(-1920, 0, 4480, 1740) };
        new WindowsInputBackend(api, _ => true).Move(1, 2);
        var mouse = api.Batches.Single().Single().Data.Mouse;
        Check(mouse.Flags == 0xc001 && mouse.Dx > 0 && mouse.Dx < 65536, "absolute virtual desktop flags");
    });
    Test("connection capacity and suspension release before closing", () =>
    {
        var fake = new FakeBackend(); var state = new ControlState(new(fake), "test"); var closed = 0;
        for (var i = 0; i < 48; i++) state.Acquire("test", _ => { }, _ => { Check(fake.Events.Last() == "release", "release before callback"); closed++; });
        Reject(() => state.Acquire("overflow", _ => { }, _ => { }));
        // Start one owner so its release is observable before callbacks.
        var a = state.Snapshot().Controllers[0].Id;
        state.Process(Message(a, 1, "drag", new { phase = "begin", dx = 1, dy = 1 }), a);
        state.Suspend(true); Check(closed == 48 && !state.Snapshot().Permitted, "suspension");
    });
    Console.WriteLine($"{passed} tests passed"); return 0;
}
catch (Exception error) { Console.Error.WriteLine(error); return 1; }

sealed class FakeBackend : IInputBackend
{
    public List<string> Events = [];
    public bool Permitted { get; set; } = true;
    public double DoubleClickInterval => .5;
    public bool ClipboardOK = true;
    public void Move(int x, int y) => Events.Add($"move:{x},{y}");
    public void Button(string b, bool down) => Events.Add($"{b}:{down}");
    public void Wheel(int x, int y) => Events.Add($"wheel:{x},{y}");
    public void Key(ushort key) => Events.Add($"key:{key}");
    public void Text(string text) => Events.Add("text:" + text);
    public bool WriteClipboard(string text) { Events.Add("clipboard:" + text); return ClipboardOK; }
    public bool PasteShortcut() { Events.Add("paste"); return true; }
    public void ReleaseAll() => Events.Add("release");
}
sealed class MemoryStore : ISettingsStore
{
    public bool Fail; public ControlSettings Value = new();
    public ControlSettings Load() => Value;
    public void Save(ControlSettings settings) { if (Fail) throw new IOException(); Value = settings; }
}
sealed class FakeApi : IInputApi
{
    public List<NativeEvent[]> Batches = [];
    public uint? NextDelivered;
    public uint Send(NativeEvent[] events) { Batches.Add(events); var delivered = NextDelivered ?? (uint)events.Length; NextDelivered = null; return delivered; }
    public Point Position { get; set; }
    public Rectangle Desktop { get; set; } = new(0, 0, 1920, 1080);
    public Rectangle[] Displays { get; set; } = [new(0, 0, 1920, 1080)];
    public uint DoubleClickTime => 500;
    public bool DesktopAvailable => true;
    public bool PhysicalModifiersDown { get; set; }
}
