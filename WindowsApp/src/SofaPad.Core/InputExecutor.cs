namespace SofaPad.Core;

public interface IInputBackend
{
    bool Permitted { get; }
    double DoubleClickInterval { get; }
    void Move(int dx, int dy);
    void Button(string button, bool down);
    void Wheel(int dx, int dy);
    void Key(ushort key);
    void Text(string text);
    bool WriteClipboard(string text);
    bool PasteShortcut();
    void ReleaseAll();
}

public sealed class InputException : Exception;

public sealed class InputExecutor(IInputBackend backend)
{
    private double moveX, moveY, scrollX, scrollY;
    private bool dragging;
    public bool Permitted => backend.Permitted;
    public double DoubleClickInterval => backend.DoubleClickInterval;
    // One protocol pixel = one Windows wheel unit. Keep fractional units; never round
    // every update to a whole 120-unit notch. Targets apply their own wheel-line preference.
    public const double WheelUnitsPerPixel = 1;
    public void Reset()
    {
        backend.ReleaseAll(); dragging = false;
        moveX = moveY = scrollX = scrollY = 0;
    }
    public void Execute(InputMessage m)
    {
        if (!Permitted) { Reset(); return; }
        try
        {
            switch (m.Type)
            {
                case "move": Move(m.Dx, m.Dy); break;
                case "click":
                    moveX = moveY = 0;
                    backend.Button(m.Button!, true); backend.Button(m.Button!, false); break;
                case "drag":
                    if (m.Phase is "end" or "cancel") { Reset(); break; }
                    if (m.Phase == "begin") { moveX = moveY = 0; backend.Button("left", true); dragging = true; }
                    if (dragging) Move(m.Dx, m.Dy);
                    break;
                case "scroll":
                    if (m.Phase is "end" or "cancel") { scrollX = scrollY = 0; break; }
                    if (m.Phase == "begin") scrollX = scrollY = 0;
                    scrollX += -m.Dx * WheelUnitsPerPixel; scrollY += m.Dy * WheelUnitsPerPixel;
                    var x = (int)scrollX; var y = (int)scrollY;
                    scrollX -= x; scrollY -= y;
                    if (x != 0 || y != 0) backend.Wheel(x, y);
                    break;
                case "edit":
                    for (var i = 0; i < m.Delete; i++) backend.Key(0x08);
                    if (!string.IsNullOrEmpty(m.Text)) backend.Text(m.Text);
                    break;
                case "backspace": backend.Key(0x08); break;
                case "enter": backend.Key(0x0D); break;
            }
        }
        catch (InputException) { Reset(); throw; }
    }
    private void Move(double dx, double dy)
    {
        moveX += dx; moveY += dy;
        var x = (int)moveX; var y = (int)moveY; moveX -= x; moveY -= y;
        if (x != 0 || y != 0) backend.Move(x, y);
    }
    public string Paste(string text)
    {
        if (!Permitted) { Reset(); return "permission"; }
        if (dragging) return "busy";
        if (!backend.WriteClipboard(text)) return "clipboard_failed";
        try { return backend.PasteShortcut() ? "executed" : "unavailable"; }
        catch (InputException) { Reset(); return "unavailable"; }
    }
}

/// Explicit development preview. It never calls Win32 or changes the clipboard.
public sealed class PreviewBackend : IInputBackend
{
    public bool Permitted => true;
    public double DoubleClickInterval => .5;
    public void Move(int dx, int dy) { }
    public void Button(string button, bool down) { }
    public void Wheel(int dx, int dy) { }
    public void Key(ushort key) { }
    public void Text(string text) { }
    public bool WriteClipboard(string text) => true;
    public bool PasteShortcut() => true;
    public void ReleaseAll() { }
}
