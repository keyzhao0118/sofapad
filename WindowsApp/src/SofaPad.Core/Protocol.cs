using System.Globalization;
using System.Text;
using System.Text.Json;

namespace SofaPad.Core;

public sealed class ProtocolException(string reason = "protocol") : Exception(reason);

public sealed record InputMessage(
    string Type, double Dx = 0, double Dy = 0, string? Phase = null,
    string? Button = null, int Count = 0, string? Text = null, int Delete = 0,
    string? RequestID = null, string? Nonce = null, SettingsPatch? Settings = null);

public static class Wire
{
    public const int MaxBytes = 16_384;
    public static readonly UTF8Encoding Utf8 = new(false, true);
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static byte[] Encode(object value) => JsonSerializer.SerializeToUtf8Bytes(value, Json);
    public static JsonDocument Parse(ReadOnlyMemory<byte> data)
    {
        if (data.Length > MaxBytes) throw new ProtocolException();
        _ = Utf8.GetString(data.Span); // Reject invalid UTF-8 instead of replacing it.
        var document = JsonDocument.Parse(data, new JsonDocumentOptions { MaxDepth = 16 });
        if (document.RootElement.ValueKind != JsonValueKind.Object) { document.Dispose(); throw new ProtocolException(); }
        return document;
    }
    public static string? String(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null ? value.GetString() : null;
    public static long? Integer(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null) return null;
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDecimal(out var n) || n != decimal.Truncate(n)
            || n < long.MinValue || n > long.MaxValue) throw new ProtocolException();
        return (long)n;
    }
    public static double? Number(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null) return null;
        var n = value.GetDouble();
        if (!double.IsFinite(n)) throw new ProtocolException();
        return n;
    }
    public static bool? Boolean(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null ? value.GetBoolean() : null;
}

/// One validator per connection. A rejected message never advances sequence or gesture state.
public sealed class ProtocolValidator(string sessionID)
{
    private long sequence;
    private string? gesture;
    private double windowStart;
    private int count;

    public InputMessage Validate(ReadOnlyMemory<byte> bytes, double now)
    {
        try
        {
            using var document = Wire.Parse(bytes);
            var root = document.RootElement;
            var seq = Wire.Integer(root, "seq");
            if (Wire.Integer(root, "v") != 2 || Wire.String(root, "sessionID") != sessionID ||
                seq is null || seq <= sequence || seq > 9_007_199_254_740_991) throw new ProtocolException();
            if (now - windowStart >= 1) { windowStart = now; count = 0; }
            if (++count > 240) throw new ProtocolException();
            var type = Wire.String(root, "type") ?? throw new ProtocolException();
            var nextGesture = gesture;
            InputMessage message;
            switch (type)
            {
                case "move": case "scroll": case "drag":
                    var dx = Wire.Number(root, "dx"); var dy = Wire.Number(root, "dy");
                    if (dx is null || dy is null || Math.Abs(dx.Value) > 2000 || Math.Abs(dy.Value) > 2000) throw new ProtocolException();
                    var phase = Wire.String(root, "phase");
                    if (type == "move") { if (gesture is not null) throw new ProtocolException(); }
                    else switch (phase)
                    {
                        case "begin": if (gesture is not null) throw new ProtocolException(); nextGesture = type; break;
                        case "update": if (gesture != type) throw new ProtocolException(); break;
                        case "end": case "cancel":
                            if (gesture != type || dx != 0 || dy != 0) throw new ProtocolException(); nextGesture = null; break;
                        default: throw new ProtocolException();
                    }
                    message = new(type, dx.Value, dy.Value, phase); break;
                case "click":
                    var button = Wire.String(root, "button"); var clicks = Wire.Integer(root, "count");
                    if (gesture is not null || button is not ("left" or "right") || clicks is not (1 or 2)
                        || (button == "right" && clicks != 1)) throw new ProtocolException();
                    message = new(type, Button: button, Count: (int)clicks.Value); break;
                case "edit":
                    var delete = Wire.Integer(root, "delete") ?? 0; var text = Wire.String(root, "text") ?? "";
                    if (gesture is not null || delete < 0 || delete > 1024 || Wire.Utf8.GetByteCount(text) > 4096
                        || (delete == 0 && text.Length == 0)) throw new ProtocolException();
                    message = new(type, Text: text, Delete: (int)delete); break;
                case "paste":
                    var pasted = Wire.String(root, "text"); var id = Wire.String(root, "requestID");
                    if (gesture is not null || string.IsNullOrEmpty(pasted) || Wire.Utf8.GetByteCount(pasted) > 12_000
                        || id is null || id.Length is < 38 or > 100 || id.Any(c => !char.IsAsciiLetterOrDigit(c) && c != ':' && c != '-'))
                        throw new ProtocolException();
                    message = new(type, Text: pasted, RequestID: id); break;
                case "enter": case "backspace":
                    if (gesture is not null) throw new ProtocolException(); message = new(type); break;
                case "ping":
                    var nonce = Wire.String(root, "nonce");
                    if (nonce is null || new StringInfo(nonce).LengthInTextElements > 64) throw new ProtocolException();
                    message = new(type, Nonce: nonce); break;
                case "settings":
                    message = new(type, Settings: SettingsPatch.Parse(root.GetProperty("settings"))); break;
                case "disconnect": message = new(type); break;
                default: throw new ProtocolException();
            }
            sequence = seq.Value; gesture = nextGesture;
            return message;
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or FormatException or
            DecoderFallbackException or EncoderFallbackException or KeyNotFoundException or OverflowException)
        { throw new ProtocolException(); }
    }
}
