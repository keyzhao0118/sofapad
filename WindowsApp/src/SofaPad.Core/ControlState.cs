using System.Diagnostics;
using System.Security.Cryptography;

namespace SofaPad.Core;

public sealed record Controller(string Id, string Label);
public sealed record ControlSnapshot(bool Permitted, Controller[] Controllers);

public sealed class ControlState
{
    private sealed class Session(string id, string label, Action<object> send, Action<string> close)
    {
        public readonly string Id = id, Label = label;
        public readonly ProtocolValidator Validator = new(id);
        public readonly Action<object> Send = send;
        public readonly Action<string> Close = close;
        public bool IgnoredGesture;
    }
    private readonly object gate = new();
    private readonly InputExecutor executor;
    private readonly ISettingsStore? store;
    private readonly Dictionary<string, Session> sessions = [];
    private readonly Dictionary<string, (string Hash, string Status)> receipts = [];
    private ControlSettings settings;
    private long revision;
    private string? owner;
    private bool suspended;
    public string Name { get; }
    public bool Preview { get; }
    public string PasteEpoch { get; } = Guid.NewGuid().ToString();
    public ControlState(InputExecutor executor, string name, bool preview = false, ISettingsStore? store = null)
    { this.executor = executor; Name = name; Preview = preview; this.store = store; settings = store?.Load() ?? new(); }
    public ControlSnapshot Snapshot()
    {
        lock (gate)
        {
            var permitted = !suspended && executor.Permitted;
            if (!permitted) executor.Reset();
            return new(permitted, sessions.Values.Select(s => new Controller(s.Id, s.Label)).ToArray());
        }
    }
    public string Acquire(string label, Action<object> send, Action<string> close)
    {
        lock (gate)
        {
            if (sessions.Count >= 48 || suspended) throw new ProtocolException("host_paused");
            var id = Guid.NewGuid().ToString(); sessions.Add(id, new(id, label, send, close)); return id;
        }
    }
    public object Ready(string id)
    {
        lock (gate) return new { type = "ready", v = 2, sessionID = id, pasteEpoch = PasteEpoch, name = Name,
            platform = "windows", permitted = !suspended && executor.Permitted, doubleClickInterval = executor.DoubleClickInterval,
            preview = Preview, capabilities = new[] { "backspace", "edit", "enter", "settings" }, settings, settingsRevision = revision };
    }
    public InputMessage Process(ReadOnlyMemory<byte> bytes, string id, double? now = null)
    {
        lock (gate)
        {
            if (!sessions.TryGetValue(id, out var session)) throw new ProtocolException();
            var m = session.Validator.Validate(bytes, now ?? (double)Stopwatch.GetTimestamp() / Stopwatch.Frequency);
            if (m.Type == "settings")
            {
                var candidate = settings.Apply(m.Settings!);
                try { store?.Save(candidate); }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException)
                { session.Send(new { type = "settingsError", reason = "storage" }); return m; }
                settings = candidate; revision++;
                var update = new { type = "settings", settings, settingsRevision = revision };
                foreach (var s in sessions.Values) s.Send(update);
                return m;
            }
            if (m.Type == "ping") { session.Send(new { type = "pong", nonce = m.Nonce }); return m; }
            if (m.Type == "disconnect") return m;
            if (m.Type == "paste") { session.Send(Paste(m, id)); return m; }
            if (m.Type is "scroll" or "drag")
            {
                if (m.Phase == "begin")
                {
                    session.IgnoredGesture = owner is not null || suspended || !executor.Permitted;
                    if (!session.IgnoredGesture) owner = id;
                }
                var ending = m.Phase is "end" or "cancel";
                if (session.IgnoredGesture || owner != id)
                { if (ending) session.IgnoredGesture = false; return m; }
                if (ending) owner = null;
            }
            else if (owner is not null && owner != id) return m;
            if (suspended || !executor.Permitted) { executor.Reset(); return m; }
            try { executor.Execute(m); }
            catch (InputException) { Release(id); session.Close("input_failed"); }
            return m;
        }
    }
    private object Paste(InputMessage m, string id)
    {
        var requestID = m.RequestID!;
        object Reply(string status, bool duplicate = false) => new { type = "pasteResult", requestID, status, duplicate };
        if (!requestID.StartsWith(PasteEpoch + ":", StringComparison.Ordinal)) return Reply("expired");
        var hash = Convert.ToHexString(SHA256.HashData(Wire.Utf8.GetBytes(m.Text!)));
        if (receipts.TryGetValue(requestID, out var old)) return Reply(old.Hash == hash ? old.Status : "id_conflict", true);
        if (receipts.Count >= 1024) return Reply("limit");
        var result = suspended || !executor.Permitted ? "permission" : owner is not null && owner != id ? "busy" : executor.Paste(m.Text!);
        receipts.Add(requestID, (hash, result)); return Reply(result);
    }
    public void Release(string id)
    {
        lock (gate)
        {
            if (!sessions.Remove(id)) return;
            if (owner == id || sessions.Count == 0) { owner = null; executor.Reset(); }
        }
    }
    public void Disconnect(string? id = null, string reason = "host_disconnect")
    {
        lock (gate)
        {
            foreach (var s in sessions.Values.Where(s => id is null || s.Id == id).ToArray())
            { Release(s.Id); s.Close(reason); }
            if (id is null) { owner = null; executor.Reset(); }
        }
    }
    public void Suspend(bool value)
    { lock (gate) { suspended = value; if (value) Disconnect(reason: "host_paused"); } }
}
