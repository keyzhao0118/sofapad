import XCTest
import ApplicationServices
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
    func mouse(_ type: CGEventType, at point: CGPoint, count: Int64) { events.append(type); points.append(point); location = point }
    func scroll(dx: Int32, dy: Int32) {}
    func writeClipboard(_ text: String) -> Bool { clipboard.append(text); return writes }
    func pasteShortcut() -> Bool { shortcuts += 1; return true }
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
    private func makeState(_ backend: FakeBackend) throws -> (ControlState, String, String) {
        let state = ControlState(store: try CredentialStore(file: nil), executor: MouseEventExecutor(backend: backend), name: "Test")
        let token = try state.beginPairing(), credential = try state.pair(token: token, name: "Phone", peer: "1")
        let id = try XCTUnwrap(state.acquire(token: credential, disconnect: { _ in }).id)
        return (state, credential, id)
    }
    func testAllSessionTerminationPathsReleaseDrag() throws {
        for path in ["release", "disconnect", "suspend", "revoke", "permission"] {
            let backend = FakeBackend(), (state, _, id) = try makeState(backend)
            _ = try state.process(data("drag", session: id, ["phase": "begin", "dx": 12, "dy": 0]), sessionID: id)
            switch path {
            case "release": state.release(id: id) // Socket close, heartbeat and protocol failures use this path.
            case "disconnect": state.disconnect()
            case "suspend": state.setSuspended(true)
            case "revoke": try state.revoke(id: XCTUnwrap(state.snapshot().devices.first).id)
            default: backend.permitted = false; _ = state.snapshot()
            }
            state.disconnect()
            XCTAssertEqual(backend.events.filter { $0 == .leftMouseUp }.count, 1, path)
        }
    }
    func testPasteDeduplicatesAcrossReconnectAndRejectsChangedText() throws {
        let backend = FakeBackend(), (state, credential, first) = try makeState(backend)
        let requestID = try XCTUnwrap(state.ready(id: first)["pasteEpoch"] as? String) + ":dedupe"
        func paste(_ id: String, _ seq: Int, _ text: String) throws -> [String: Any] {
            let parsed = try state.process(data("paste", session: id, seq: seq, ["requestID": requestID, "text": text]), sessionID: id)
            return state.paste(parsed, sessionID: id)
        }
        XCTAssertEqual(try paste(first, 1, "原文")["status"] as? String, "executed")
        state.release(id: first)
        let second = try XCTUnwrap(state.acquire(token: credential, disconnect: { _ in }).id)
        let duplicate = try paste(second, 1, "原文")
        XCTAssertEqual(duplicate["duplicate"] as? Bool, true); XCTAssertEqual(duplicate["status"] as? String, "executed")
        XCTAssertEqual(try paste(second, 2, "修改后")["status"] as? String, "id_conflict")
        XCTAssertEqual(backend.clipboard, ["原文"]); XCTAssertEqual(backend.shortcuts, 1)
    }
    func testFailureReceiptIsNotRetriedAndOldEpochIsRejected() throws {
        let backend = FakeBackend(), (state, _, id) = try makeState(backend)
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
        let backend = FakeBackend(), (state, _, id) = try makeState(backend)
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
    func testHTTPSPolicyIsSchemeBoundAndUsesSeparateCookie() {
        let policy = AccessPolicy(hosts: ["127.0.0.1:9876"], secure: true)
        XCTAssertTrue(policy.accepts(host: "127.0.0.1:9876", origin: "https://127.0.0.1:9876", requiresOrigin: true))
        XCTAssertFalse(policy.accepts(host: "127.0.0.1:9876", origin: "http://127.0.0.1:9876", requiresOrigin: true))
        let token = String(repeating: "a", count: 43)
        XCTAssertNil(AccessPolicy.credential(cookie: "sofapad=" + token, secure: true))
        XCTAssertEqual(AccessPolicy.credential(cookie: "__Host-sofapad=" + token, secure: true), token)
    }
}
