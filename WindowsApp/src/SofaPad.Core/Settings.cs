using System.Text.Json;

namespace SofaPad.Core;

public sealed record ControlSettings(double Pointer = 1.5, double Scroll = 0.3, bool Natural = true, bool KeepAwake = true)
{
    [System.Text.Json.Serialization.JsonIgnore]
    public bool Valid => double.IsFinite(Pointer) && Pointer is >= .2 and <= 5 && double.IsFinite(Scroll) && Scroll is >= .05 and <= 5;
    public ControlSettings Apply(SettingsPatch p) => new(p.Pointer ?? Pointer, p.Scroll ?? Scroll, p.Natural ?? Natural, p.KeepAwake ?? KeepAwake);
}

public sealed record SettingsPatch(double? Pointer = null, double? Scroll = null, bool? Natural = null, bool? KeepAwake = null)
{
    public static SettingsPatch Parse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) throw new ProtocolException();
        var patch = new SettingsPatch(Wire.Number(root, "pointer"), Wire.Number(root, "scroll"), Wire.Boolean(root, "natural"), Wire.Boolean(root, "keepAwake"));
        if ((patch.Pointer is null && patch.Scroll is null && patch.Natural is null && patch.KeepAwake is null)
            || !new ControlSettings().Apply(patch).Valid) throw new ProtocolException();
        return patch;
    }
}

public interface ISettingsStore
{
    ControlSettings Load();
    void Save(ControlSettings settings);
}

public sealed class JsonSettingsStore(string path, Action<string>? diagnostic = null) : ISettingsStore
{
    private sealed record Saved(int Version, ControlSettings Settings);
    public ControlSettings Load()
    {
        if (!File.Exists(path)) return new();
        try
        {
            var saved = JsonSerializer.Deserialize<Saved>(File.ReadAllBytes(path), Wire.Json);
            if (saved is not { Version: 1, Settings.Valid: true }) throw new JsonException("Unsupported settings");
            return saved.Settings;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            diagnostic?.Invoke("设置读取失败，使用默认值：" + e.GetType().Name);
            // Preserve the corrupt file. The next successful save replaces it atomically.
            try { File.Copy(path, path + ".invalid", true); } catch (Exception copy) when (copy is IOException or UnauthorizedAccessException) { }
            return new();
        }
    }
    public void Save(ControlSettings settings)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            { file.Write(Wire.Encode(new Saved(1, settings))); file.Flush(true); }
            File.Move(temporary, path, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
