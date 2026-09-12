import XCTest
import ApplicationServices
import Carbon.HIToolbox
@testable import SofaPadCore

private final class FakeBackend: SystemInputBackend {
    var permitted = true
    var doubleClickInterval = 0.5
    var location = CGPoint(x: 200, y: 100)
    var events: [CGEventType] = []
    var points: [CGPoint] = []
    var clipboard: [String] = []
    var writes = true
    var shortcuts = 0
    var backspaces = 0
    var returns = 0
    var typed: [String] = []
    func mouse(_ type: CGEventType, at point: CGPoint, count: Int64) { events.append(type); points.append(point); location = point }
    func scroll(dx: Int32, dy: Int32) {}
    func writeClipboard(_ text: String) -> Bool { clipboard.append(text); return writes }
    func pasteShortcut() -> Bool { shortcuts += 1; return true }
    func backspace() { backspaces += 1 }
    func returnKey() { returns += 1 }
    func typeText(_ text: String) { typed.append(text) }
}

final class InputTests: XCTestCase {
    private func message(_ type: String, session: String = "test", seq: Int = 1, _ fields: [String: Any] = [:]) throws -> InputMessage {
        try JSONDecoder().decode(InputMessage.self, from: data(type, session: session, seq: seq, fields))
    }
    private func data(_ type: String, session: String = "test", seq: Int = 1, _ fields: [String: Any] = [:]) throws -> Data {
        try JSONSerialization.data(withJSONObject: fields.merging(["type": type, "v": 2, "sessionID": session, "seq": seq]) { _, new in new })
    }
    func testDragUsesCurrentPointerAndReleasesOnce() throws {
        let backend = FakeBackend(), executor = MouseEventExecutor(backend: backend)
        try executor.execute(message("drag", ["phase": "begin", "dx": 10.5, "dy": 4]))
        try executor.execute(message("drag", ["phase": "update", "dx": 0.5, "dy": 2]))
        try executor.execute(message("drag", ["phase": "end", "dx": 0, "dy": 0]))
        executor.reset()
        XCTAssertEqual(backend.events, [.leftMouseDown, .leftMouseDragged, .leftMouseDragged, .leftMouseUp])
        XCTAssertEqual(backend.points.first, CGPoint(x: 200, y: 100))
        XCTAssertEqual(backend.location, CGPoint(x: 211, y: 106))
    }
    func testPermissionLossAndCancellationAttemptRelease() throws {
        for losesPermission in [true, false] {
            let backend = FakeBackend(), executor = MouseEventExecutor(backend: backend)
            try executor.execute(message("drag", ["phase": "begin", "dx": 9, "dy": 0]))
            backend.permitted = !losesPermission
            try executor.execute(message("drag", ["phase": "cancel", "dx": 0, "dy": 0]))
            executor.reset()
            XCTAssertEqual(backend.events.filter { $0 == .leftMouseUp }.count, 1)
        }
    }
    func testPasteExactTextAndClipboardFailureNeverSendsShortcut() throws {
        let backend = FakeBackend(), executor = MouseEventExecutor(backend: backend)
        let text = "  中文 👨‍👩‍👧‍👦 e\u{301}\n第二行\n"
        XCTAssertEqual(executor.paste(text), "executed"); XCTAssertEqual(backend.clipboard, [text]); XCTAssertEqual(backend.shortcuts, 1)
        backend.writes = false
        XCTAssertEqual(executor.paste("failure"), "clipboard_failed"); XCTAssertEqual(backend.shortcuts, 1)
        backend.permitted = false
        XCTAssertEqual(executor.paste("no permission"), "permission"); XCTAssertEqual(backend.clipboard.count, 2)
    }
    func testPasteCannotInterruptHeldDrag() throws {
        let backend = FakeBackend(), executor = MouseEventExecutor(backend: backend)
        try executor.execute(message("drag", ["phase": "begin", "dx": 9, "dy": 0]))
        XCTAssertEqual(executor.paste("draft"), "busy"); XCTAssertTrue(backend.clipboard.isEmpty); XCTAssertEqual(backend.shortcuts, 0)
        executor.reset()
    }
    func testBackspaceAndReturnAreSingleUnmodifiedKeyPresses() throws {
        // Build native events without posting them to any application.
        let backspace = try XCTUnwrap(QuartzInputBackend.keyEvents(CGKeyCode(kVK_Delete), source: nil))
        XCTAssertEqual(backspace.map(\.type), [.keyDown, .keyUp])
        for event in backspace {
            XCTAssertEqual(event.getIntegerValueField(.keyboardEventKeycode), 0x33)
            XCTAssertEqual(event.getIntegerValueField(.keyboardEventAutorepeat), 0)
            XCTAssertEqual(event.flags, [])
        }
        let enter = try XCTUnwrap(QuartzInputBackend.keyEvents(CGKeyCode(kVK_Return), source: nil))
        XCTAssertEqual(enter.map(\.type), [.keyDown, .keyUp])
        for event in enter {
            XCTAssertEqual(event.getIntegerValueField(.keyboardEventKeycode), 0x24)
            XCTAssertEqual(event.getIntegerValueField(.keyboardEventAutorepeat), 0)
            XCTAssertEqual(event.flags, [])
        }
    }
    func testEnterPressesReturnOnceAndRespectsPermissionAndDrag() throws {
        let backend = FakeBackend(), (state, id) = try makeState(backend)
        _ = try state.process(data("enter", session: id), sessionID: id)
        XCTAssertEqual(backend.returns, 1)
        XCTAssertThrowsError(try state.process(data("enter", session: id), sessionID: id))
        XCTAssertEqual(backend.returns, 1)
        backend.permitted = false
        _ = try state.process(data("enter", session: id, seq: 2), sessionID: id)
        XCTAssertEqual(backend.returns, 1)
        backend.permitted = true
        let executor = MouseEventExecutor(backend: backend)
        try executor.execute(message("drag", ["phase": "begin", "dx": 0, "dy": 0]))
        try executor.execute(message("enter")); XCTAssertEqual(backend.returns, 1)
        executor.reset()
        try executor.execute(message("enter")); XCTAssertEqual(backend.returns, 2)
        XCTAssertTrue(backend.clipboard.isEmpty); XCTAssertEqual(backend.shortcuts, 0)
    }
    func testBackspaceExecutesOnceWithoutTouchingClipboardAndRespectsPermission() throws {
        let backend = FakeBackend(), (state, id) = try makeState(backend)
        XCTAssertEqual(state.ready(id: id)["capabilities"] as? [String], ["backspace", "edit", "enter"])
        let deletion = try data("backspace", session: id)
        _ = try state.process(deletion, sessionID: id)
        XCTAssertEqual(backend.backspaces, 1)
        XCTAssertThrowsError(try state.process(deletion, sessionID: id))
        XCTAssertEqual(backend.backspaces, 1)
        backend.permitted = false
        _ = try state.process(data("backspace", session: id, seq: 2), sessionID: id)
        XCTAssertEqual(backend.backspaces, 1)
        XCTAssertTrue(backend.clipboard.isEmpty); XCTAssertTrue(backend.events.isEmpty); XCTAssertEqual(backend.shortcuts, 0)
        state.release(id: id)
        XCTAssertThrowsError(try state.process(data("backspace", session: id, seq: 3), sessionID: id))
        XCTAssertEqual(backend.backspaces, 1)
    }
    func testLiveEditDeletesThenTypesWithoutTouchingClipboard() throws {
        let backend = FakeBackend(), (state, id) = try makeState(backend)
        XCTAssertEqual(state.ready(id: id)["capabilities"] as? [String], ["backspace", "edit", "enter"])
        _ = try state.process(data("edit", session: id, seq: 1, ["delete": 2, "text": "中a"]), sessionID: id)
        XCTAssertEqual(backend.backspaces, 2); XCTAssertEqual(backend.typed, ["中a"])
        _ = try state.process(data("edit", session: id, seq: 2, ["delete": 1, "text": ""]), sessionID: id)
        XCTAssertEqual(backend.backspaces, 3); XCTAssertEqual(backend.typed, ["中a"])
        backend.permitted = false
        _ = try state.process(data("edit", session: id, seq: 3, ["text": "x"]), sessionID: id)
        XCTAssertEqual(backend.typed, ["中a"])
        XCTAssertTrue(backend.clipboard.isEmpty); XCTAssertEqual(backend.shortcuts, 0)
    }
    func testLiveEditCannotInterruptHeldDrag() throws {
        let backend = FakeBackend(), executor = MouseEventExecutor(backend: backend)
        try executor.execute(message("drag", ["phase": "begin", "dx": 0, "dy": 0]))
        try executor.execute(message("edit", ["delete": 1, "text": "x"]))
        XCTAssertEqual(backend.backspaces, 0); XCTAssertTrue(backend.typed.isEmpty)
        executor.reset()
        try executor.execute(message("edit", ["delete": 1, "text": "x"]))
        XCTAssertEqual(backend.backspaces, 1); XCTAssertEqual(backend.typed, ["x"])
    }
    func testLiveEditIsRejectedByTheProtocolValidator() throws {
        var validator = ProtocolValidator(sessionID: "test-session")
        func validate(_ fields: [String: Any], seq: Int) throws {
            let body = try JSONSerialization.data(withJSONObject: fields.merging(["type": "edit", "v": 2, "sessionID": "test-session", "seq": seq]) { _, new in new })
            _ = try validator.validate(body, now: 1)
        }
        XCTAssertThrowsError(try validate(["delete": 0, "text": ""], seq: 1))          // nothing to do
        XCTAssertThrowsError(try validate(["delete": -1, "text": "a"], seq: 1))        // negative removal
        XCTAssertThrowsError(try validate(["delete": 5_000, "text": "a"], seq: 1))     // removal beyond the cap
        XCTAssertThrowsError(try validate(["delete": 0, "text": String(repeating: "中", count: 1_400)], seq: 1))
        XCTAssertNoThrow(try validate(["delete": 3, "text": "👩🏽‍💻"], seq: 1))
    }
    func testBackspaceCannotInterruptHeldDrag() throws {
        let backend = FakeBackend(), executor = MouseEventExecutor(backend: backend)
        try executor.execute(message("drag", ["phase": "begin", "dx": 0, "dy": 0]))
        try executor.execute(message("backspace")); XCTAssertEqual(backend.backspaces, 0)
        executor.reset()
        try executor.execute(message("backspace")); XCTAssertEqual(backend.backspaces, 1)
    }
    private func makeState(_ backend: FakeBackend) throws -> (ControlState, String) {
        let state = ControlState(executor: MouseEventExecutor(backend: backend), name: "Test")
        let id = state.acquire(label: "Test", disconnect: { _ in })
        return (state, id)
    }
    func testAllSessionTerminationPathsReleaseDrag() throws {
        for path in ["release", "disconnect", "suspend", "permission"] {
            let backend = FakeBackend(), (state, id) = try makeState(backend)
            _ = try state.process(data("drag", session: id, ["phase": "begin", "dx": 12, "dy": 0]), sessionID: id)
            switch path {
            case "release": state.release(id: id) // Socket close, heartbeat and protocol failures use this path.
            case "disconnect": state.disconnect()
            case "suspend": state.setSuspended(true)
            default: backend.permitted = false; _ = state.snapshot()
            }
            state.disconnect()
            XCTAssertEqual(backend.events.filter { $0 == .leftMouseUp }.count, 1, path)
        }
    }
    func testPasteDeduplicatesAcrossSessionsAndRejectsChangedText() throws {
        let backend = FakeBackend(), (state, first) = try makeState(backend)
        let requestID = try XCTUnwrap(state.ready(id: first)["pasteEpoch"] as? String) + ":dedupe"
        func paste(_ id: String, _ seq: Int, _ text: String) throws -> [String: Any] {
            let parsed = try state.process(data("paste", session: id, seq: seq, ["requestID": requestID, "text": text]), sessionID: id)
            return state.paste(parsed, sessionID: id)
        }
        XCTAssertEqual(try paste(first, 1, "原文")["status"] as? String, "executed")
        // A second phone asking with the same request gets the stored receipt, not a second paste.
        let second = state.acquire(label: "Test", disconnect: { _ in })
        let duplicate = try paste(second, 1, "原文")
        XCTAssertEqual(duplicate["duplicate"] as? Bool, true); XCTAssertEqual(duplicate["status"] as? String, "executed")
        XCTAssertEqual(try paste(second, 2, "修改后")["status"] as? String, "id_conflict")
        XCTAssertEqual(backend.clipboard, ["原文"]); XCTAssertEqual(backend.shortcuts, 1)
    }
    func testFailureReceiptIsNotRetriedAndOldEpochIsRejected() throws {
        let backend = FakeBackend(), (state, id) = try makeState(backend)
        let epoch = try XCTUnwrap(state.ready(id: id)["pasteEpoch"] as? String)
        let request = try message("paste", session: id, ["requestID": epoch + ":failure", "text": "原文"])
        backend.writes = false
        XCTAssertEqual(state.paste(request, sessionID: id)["status"] as? String, "clipboard_failed")
        backend.writes = true
        XCTAssertEqual(state.paste(request, sessionID: id)["status"] as? String, "clipboard_failed")
        let expired = try message("paste", session: id, ["requestID": UUID().uuidString + ":old", "text": "旧文"])
        XCTAssertEqual(state.paste(expired, sessionID: id)["status"] as? String, "expired")
        XCTAssertEqual(backend.clipboard.count, 1); XCTAssertEqual(backend.shortcuts, 0)
    }
    func testReceiptLimitNeverEvictsAnExecutedRequest() throws {
        let backend = FakeBackend(), (state, id) = try makeState(backend)
        let epoch = try XCTUnwrap(state.ready(id: id)["pasteEpoch"] as? String)
        for i in 1...1024 {
            let request = try message("paste", session: id, ["requestID": epoch + ":\(i)", "text": "text"])
            XCTAssertEqual(state.paste(request, sessionID: id)["status"] as? String, "executed")
        }
        let extra = try message("paste", session: id, ["requestID": epoch + ":extra", "text": "text"])
        XCTAssertEqual(state.paste(extra, sessionID: id)["status"] as? String, "limit")
        let oldest = try message("paste", session: id, ["requestID": epoch + ":1", "text": "text"])
        XCTAssertEqual(state.paste(oldest, sessionID: id)["duplicate"] as? Bool, true)
        XCTAssertEqual(backend.shortcuts, 1024)
    }
}
