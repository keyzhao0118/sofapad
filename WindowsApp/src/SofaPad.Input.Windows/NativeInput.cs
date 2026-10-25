using System.Runtime.InteropServices;
using SofaPad.Core;

namespace SofaPad.Input.Windows;

[StructLayout(LayoutKind.Sequential)]
public struct NativeEvent
{
    public uint Type;
    public InputUnion Data;
    public static NativeEvent Mouse(uint flags, int x = 0, int y = 0, int data = 0) => new()
    { Type = 0, Data = new() { Mouse = new() { Dx = x, Dy = y, Flags = flags, MouseData = unchecked((uint)data) } } };
    public static NativeEvent Key(ushort code, bool up, bool unicode = false) => new()
    { Type = 1, Data = new() { Keyboard = new() { Vk = unicode ? (ushort)0 : code, Scan = unicode ? code : (ushort)0, Flags = (up ? 2u : 0u) | (unicode ? 4u : 0u) } } };
}
[StructLayout(LayoutKind.Explicit)]
public struct InputUnion
{
    [FieldOffset(0)] public MouseInput Mouse;
    [FieldOffset(0)] public KeyboardInput Keyboard;
}
[StructLayout(LayoutKind.Sequential)]
public struct MouseInput { public int Dx, Dy; public uint MouseData, Flags, Time; public UIntPtr Extra; }
[StructLayout(LayoutKind.Sequential)]
public struct KeyboardInput { public ushort Vk, Scan; public uint Flags, Time; public UIntPtr Extra; }
[StructLayout(LayoutKind.Sequential)]
public struct NativePoint { public int X, Y; }

public interface IInputApi
{
    uint Send(NativeEvent[] events);
    Point Position { get; }
    Rectangle Desktop { get; }
    Rectangle[] Displays { get; }
    uint DoubleClickTime { get; }
    bool DesktopAvailable { get; }
    bool PhysicalModifiersDown { get; }
}

public sealed class Win32InputApi : IInputApi
{
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, NativeEvent[] inputs, int size);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out NativePoint point);
    [DllImport("user32.dll")] private static extern uint GetDoubleClickTime();
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] private static extern bool CloseDesktop(IntPtr desktop);
    public uint Send(NativeEvent[] events) => SendInput((uint)events.Length, events, Marshal.SizeOf<NativeEvent>());
    public Point Position => GetCursorPos(out var p) ? new(p.X, p.Y) : throw new InputException();
    public Rectangle Desktop => new(GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79));
    public Rectangle[] Displays => Screen.AllScreens.Select(s => s.Bounds).ToArray();
    public uint DoubleClickTime => GetDoubleClickTime();
    public bool DesktopAvailable
    {
        get
        {
            var handle = OpenInputDesktop(0, false, 0x0100); // DESKTOP_SWITCHDESKTOP access, no desktop switching.
            if (handle == IntPtr.Zero) return false;
            CloseDesktop(handle); return true;
        }
    }
    public bool PhysicalModifiersDown => new[] { 0x10, 0x11, 0x12, 0x5B, 0x5C }.Any(k => (GetAsyncKeyState(k) & 0x8000) != 0);
}

/// Tracks only successfully injected downs. Partial SendInput cannot strand our keys.
public sealed class WindowsInputBackend(IInputApi api, Func<string, bool> clipboard) : IInputBackend
{
    private readonly HashSet<(ushort Code, bool Unicode)> heldKeys = [];
    private readonly HashSet<string> heldButtons = [];
    public bool Permitted => api.DesktopAvailable;
    public double DoubleClickInterval => api.DoubleClickTime / 1000d;
    public void Move(int dx, int dy)
    {
        var current = api.Position;
        var target = ClampToDisplays(new(current.X + dx, current.Y + dy), api.Displays);
        var desktop = api.Desktop;
        // Midpoint of each physical pixel in the 65536-unit virtual desktop space.
        var x = Math.Clamp((int)(((target.X - desktop.Left) + .5) * 65536 / desktop.Width), 0, 65535);
        var y = Math.Clamp((int)(((target.Y - desktop.Top) + .5) * 65536 / desktop.Height), 0, 65535);
        Send([NativeEvent.Mouse(0x0001 | 0x8000 | 0x4000, x, y)]);
    }
    public static Point ClampToDisplays(Point point, Rectangle[] displays)
    {
        if (displays.Length == 0) throw new InputException();
        return displays.Select(r => new Point(Math.Clamp(point.X, r.Left, r.Right - 1), Math.Clamp(point.Y, r.Top, r.Bottom - 1)))
            .MinBy(p => Math.Pow((double)p.X - point.X, 2) + Math.Pow((double)p.Y - point.Y, 2));
    }
    public void Button(string button, bool down) => Send([NativeEvent.Mouse(button == "right" ? (down ? 8u : 16u) : (down ? 2u : 4u))]);
    public void Wheel(int dx, int dy)
    {
        if (dy != 0) Send([NativeEvent.Mouse(0x0800, data: dy)]);
        if (dx != 0) Send([NativeEvent.Mouse(0x1000, data: dx)]);
    }
    public void Key(ushort key) => Send([NativeEvent.Key(key, false), NativeEvent.Key(key, true)]);
    public void Text(string text)
    {
        // UTF-16 units are intentional, including both halves of non-BMP characters.
        foreach (var chunk in text.Chunk(128))
            Send(chunk.SelectMany(c => new[] { NativeEvent.Key(c, false, true), NativeEvent.Key(c, true, true) }).ToArray());
    }
    public bool WriteClipboard(string text) => clipboard(text);
    public bool PasteShortcut()
    {
        // Do not release or borrow the user's physical modifiers.
        if (api.PhysicalModifiersDown) return false;
        Send([NativeEvent.Key(0x11, false), NativeEvent.Key(0x56, false), NativeEvent.Key(0x56, true), NativeEvent.Key(0x11, true)]);
        return true;
    }
    private void Send(NativeEvent[] events)
    {
        var delivered = api.Send(events);
        foreach (var e in events.Take((int)Math.Min(delivered, (uint)events.Length))) Track(e);
        if (delivered != events.Length) { ReleaseAll(); throw new InputException(); }
    }
    private void Track(NativeEvent e)
    {
        if (e.Type == 1)
        {
            var key = e.Data.Keyboard; var unicode = (key.Flags & 4) != 0;
            var id = (unicode ? key.Scan : key.Vk, unicode);
            if ((key.Flags & 2) != 0) heldKeys.Remove(id); else heldKeys.Add(id);
        }
        else
        {
            var flags = e.Data.Mouse.Flags;
            if ((flags & 2) != 0) heldButtons.Add("left"); if ((flags & 4) != 0) heldButtons.Remove("left");
            if ((flags & 8) != 0) heldButtons.Add("right"); if ((flags & 16) != 0) heldButtons.Remove("right");
        }
    }
    public void ReleaseAll()
    {
        var releases = heldKeys.Select(k => NativeEvent.Key(k.Code, true, k.Unicode))
            .Concat(heldButtons.Select(b => NativeEvent.Mouse(b == "left" ? 4u : 16u))).ToArray();
        if (releases.Length == 0) return;
        var delivered = api.Send(releases);
        foreach (var e in releases.Take((int)Math.Min(delivered, (uint)releases.Length))) Track(e);
        // Keep failed releases tracked: later pause/exit/permission checks retry them.
    }
}
