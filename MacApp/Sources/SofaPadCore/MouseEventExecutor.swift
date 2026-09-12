import AppKit
import ApplicationServices
import Carbon.HIToolbox

/// Injectable side-effect boundary; tests never touch the real pointer or clipboard.
public protocol SystemInputBackend: AnyObject {
    var permitted: Bool { get }
    var doubleClickInterval: Double { get }
    var location: CGPoint { get }
    func mouse(_ type: CGEventType, at point: CGPoint, count: Int64)
    func scroll(dx: Int32, dy: Int32)
    func writeClipboard(_ text: String) -> Bool
    func pasteShortcut() -> Bool
    func backspace()
    func returnKey()
    func typeText(_ text: String)
}

public final class MouseEventExecutor: InputExecutor {
    private let backend: SystemInputBackend
    private var scrollRemainder = CGPoint.zero
    private var moveRemainder = CGPoint.zero
    private var previousClick: (time: TimeInterval, point: CGPoint)?
    private var dragging = false
    public init(backend: SystemInputBackend = QuartzInputBackend()) { self.backend = backend }
    public var permitted: Bool { backend.permitted }
    public var doubleClickInterval: Double { backend.doubleClickInterval }
    public func reset() {
        // Cleanup must be attempted even after permission loss, not gated by permitted.
        if dragging { backend.mouse(.leftMouseUp, at: backend.location, count: 1); dragging = false }
        scrollRemainder = .zero; moveRemainder = .zero; previousClick = nil
    }
    public func execute(_ message: InputMessage) {
        guard permitted else { reset(); return }
        switch message.type {
        case "drag":
            previousClick = nil
            if ["end", "cancel"].contains(message.phase) { reset(); return }
            if message.phase == "begin" {
                guard !dragging else { return }
                moveRemainder = .zero
                backend.mouse(.leftMouseDown, at: backend.location, count: 1); dragging = true
            }
            guard dragging else { return }
            move(dx: message.dx ?? 0, dy: message.dy ?? 0, type: .leftMouseDragged)
        case "move":
            previousClick = nil
            guard !dragging else { return }
            move(dx: message.dx ?? 0, dy: message.dy ?? 0, type: .mouseMoved)
        case "click":
            guard !dragging else { return }
            moveRemainder = .zero
            let location = backend.location, right = message.button == "right"
            let now = ProcessInfo.processInfo.systemUptime
            var count: Int64 = 1
            if !right, message.count == 2, let last = previousClick,
               now - last.time <= doubleClickInterval + 0.08,
               hypot(location.x - last.point.x, location.y - last.point.y) <= 6 { count = 2 }
            backend.mouse(right ? .rightMouseDown : .leftMouseDown, at: location, count: count)
            backend.mouse(right ? .rightMouseUp : .leftMouseUp, at: location, count: count)
            previousClick = !right && count == 1 ? (now, location) : nil
        case "scroll":
            guard !dragging else { return }
            previousClick = nil
            if ["end", "cancel"].contains(message.phase) { scrollRemainder = .zero; return }
            if message.phase == "begin" { scrollRemainder = .zero }
            scrollRemainder.x += message.dx ?? 0; scrollRemainder.y += message.dy ?? 0
            let dx = Int32(scrollRemainder.x.rounded(.towardZero)), dy = Int32(scrollRemainder.y.rounded(.towardZero))
            scrollRemainder.x -= Double(dx); scrollRemainder.y -= Double(dy)
            if dx != 0 || dy != 0 { backend.scroll(dx: dx, dy: dy) }
        case "edit":
            guard !dragging else { return }
            previousClick = nil
            for _ in 0..<(message.delete ?? 0) { backend.backspace() }
            if let text = message.text, !text.isEmpty { backend.typeText(text) }
        case "backspace":
            guard !dragging else { return }
            previousClick = nil
            backend.backspace()
        case "enter":
            guard !dragging else { return }
            previousClick = nil
            backend.returnKey()
        default: break
        }
    }
    public func paste(_ text: String) -> String {
        guard permitted else { reset(); return "permission" }
        guard !dragging else { return "busy" }
        guard backend.writeClipboard(text) else { return "clipboard_failed" }
        // No activation, target lookup, selection, Enter, or clipboard restoration.
        return backend.pasteShortcut() ? "executed" : "unavailable"
    }
    private func move(dx: Double, dy: Double, type: CGEventType) {
        moveRemainder.x += dx; moveRemainder.y += dy
        let x = moveRemainder.x.rounded(.towardZero), y = moveRemainder.y.rounded(.towardZero)
        moveRemainder.x -= x; moveRemainder.y -= y
        guard x != 0 || y != 0 else { return }
        let location = backend.location
        backend.mouse(type, at: CGPoint(x: location.x + x, y: location.y + y), count: 1)
    }
}

public final class QuartzInputBackend: SystemInputBackend {
    private let source = CGEventSource(stateID: .privateState)
    public init() {}
    public var permitted: Bool { AXIsProcessTrusted() }
    public var doubleClickInterval: Double { NSEvent.doubleClickInterval }
    public var location: CGPoint { CGEvent(source: nil)?.location ?? .zero }
    public func mouse(_ type: CGEventType, at point: CGPoint, count: Int64) {
        let right = type == .rightMouseDown || type == .rightMouseUp
        guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: Self.clamp(point), mouseButton: right ? .right : .left) else { return }
        event.setIntegerValueField(.mouseEventClickState, value: count)
        event.post(tap: .cghidEventTap)
    }
    public func scroll(dx: Int32, dy: Int32) {
        let event = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)
        event?.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
        event?.post(tap: .cghidEventTap)
    }
    public func writeClipboard(_ text: String) -> Bool {
        let board = NSPasteboard.general
        board.clearContents()
        return board.setString(text, forType: .string)
    }
    public func pasteShortcut() -> Bool {
        guard permitted,
              let commandDown = CGEvent(keyboardEventSource: source, virtualKey: 55, keyDown: true),
              let vDown = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true),
              let vUp = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false),
              let commandUp = CGEvent(keyboardEventSource: source, virtualKey: 55, keyDown: false) else { return false }
        commandDown.flags = .maskCommand; vDown.flags = .maskCommand; vUp.flags = .maskCommand; commandUp.flags = []
        // All events are prepared before posting. No async gap can strand the modifier.
        for event in [commandDown, vDown, vUp, commandUp] { event.post(tap: .cghidEventTap) }
        return true
    }
    public func backspace() {
        guard permitted, let events = Self.keyEvents(CGKeyCode(kVK_Delete), source: source) else { return }
        for event in events { event.post(tap: .cghidEventTap) }
    }
    /// A real Return press: the target app decides newline, confirm or submit.
    public func returnKey() {
        guard permitted, let events = Self.keyEvents(CGKeyCode(kVK_Return), source: source) else { return }
        for event in events { event.post(tap: .cghidEventTap) }
    }
    /// Synthesized text for live typing. Chunked because a single event carries a
    /// limited Unicode string; no keycodes, modifiers, clipboard or focus changes.
    public func typeText(_ text: String) {
        guard permitted else { return }
        let units = Array(text.utf16)
        var index = 0
        while index < units.count {
            let end = min(index + 20, units.count), chunk = Array(units[index..<end])
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else { return }
            chunk.withUnsafeBufferPointer { buffer in
                down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
            }
            down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
            index = end
        }
    }
    static func keyEvents(_ code: CGKeyCode, source: CGEventSource?) -> [CGEvent]? {
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else { return nil }
        // Prepare both events before posting; no modifiers, repeat, focus change or clipboard access.
        for event in [down, up] { event.flags = []; event.setIntegerValueField(.keyboardEventAutorepeat, value: 0) }
        return [down, up]
    }
    private static func clamp(_ point: CGPoint) -> CGPoint {
        var ids = [CGDirectDisplayID](repeating: 0, count: 32), count: UInt32 = 0
        guard CGGetActiveDisplayList(32, &ids, &count) == .success else { return point }
        var nearest = point, distance = Double.infinity
        for id in ids.prefix(Int(count)) {
            let bounds = CGDisplayBounds(id)
            let candidate = CGPoint(x: min(max(point.x, bounds.minX), bounds.maxX - 1), y: min(max(point.y, bounds.minY), bounds.maxY - 1))
            let d = hypot(candidate.x - point.x, candidate.y - point.y)
            if d < distance { nearest = candidate; distance = d }
        }
        return nearest
    }
}
