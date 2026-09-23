import XCTest
@testable import SofaPadCore

final class SettingsTests: XCTestCase {
    func testPersistenceBroadcastMergeAndReconnect() throws {
        let suite = "SofaPad.SettingsTests.\(UUID().uuidString)"
        let preferences = UserDefaults(suiteName: suite)!
        defer { preferences.removePersistentDomain(forName: suite) }
        let executor = PreviewExecutor()
        let state = ControlState(executor: executor, name: "Test", preferences: preferences)
        var first: [[String: Any]] = [], second: [[String: Any]] = []
        let a = state.acquire(label: "A", settingsChanged: { first.append($0) }, disconnect: { _ in })
        let b = state.acquire(label: "B", settingsChanged: { second.append($0) }, disconnect: { _ in })
        func send(_ id: String, _ seq: Int, _ patch: [String: Any]) throws {
            let data = try JSONSerialization.data(withJSONObject: ["type": "settings", "v": 2, "sessionID": id, "seq": seq, "settings": patch])
            _ = try state.process(data, sessionID: id)
        }
        try send(a, 1, ["pointer": 2.4, "keepAwake": false])
        try send(b, 1, ["scroll": 0.15, "natural": false])
        let expected = ["pointer": 2.4, "scroll": 0.15, "natural": false, "keepAwake": false] as [String: Any]
        XCTAssertEqual(first.count, 2); XCTAssertEqual(second.count, 2)
        XCTAssertEqual(first.last?["settingsRevision"] as? Int, 2)
        XCTAssertEqual(first.last?["settings"] as? NSDictionary, expected as NSDictionary)
        XCTAssertEqual(second.last?["settings"] as? NSDictionary, expected as NSDictionary)
        XCTAssertEqual(executor.count, 0, "Saving preferences must not generate Mac input")
        state.release(id: a)
        let reconnected = state.acquire(label: "A", disconnect: { _ in })
        XCTAssertEqual(state.ready(id: reconnected)["settings"] as? NSDictionary, expected as NSDictionary)
        let restarted = ControlState(executor: PreviewExecutor(), name: "Test", preferences: UserDefaults(suiteName: suite))
        XCTAssertEqual(restarted.ready(id: "new")["settings"] as? NSDictionary, expected as NSDictionary)
    }
    func testInvalidSettingsCannotChangeSavedPreferences() throws {
        let state = ControlState(executor: PreviewExecutor(), name: "Test")
        let id = state.acquire(label: "A", disconnect: { _ in })
        let before = state.ready(id: id)["settings"] as? NSDictionary
        for patch: [String: Any] in [["pointer": 0.1], ["scroll": 6], ["natural": "true"], ["keepAwake": 1], [:], ["pointer": 2, "scroll": -1]] {
            let data = try JSONSerialization.data(withJSONObject: ["type": "settings", "v": 2, "sessionID": id, "seq": 1, "settings": patch])
            XCTAssertThrowsError(try state.process(data, sessionID: id))
            XCTAssertEqual(state.ready(id: id)["settings"] as? NSDictionary, before)
        }
    }
    func testCorruptStoredSettingsFallBackToDefaults() {
        let suite = "SofaPad.SettingsTests.\(UUID().uuidString)"
        // Use an isolated domain and never touch the app's standard preferences.
        let isolated = UserDefaults(suiteName: suite)!
        defer { isolated.removePersistentDomain(forName: suite) }
        isolated.set(Data("{\"pointer\":99,\"scroll\":0.3,\"natural\":true,\"keepAwake\":true}".utf8), forKey: "SofaPad.ControlSettings.v1")
        let state = ControlState(executor: PreviewExecutor(), name: "Test", preferences: isolated)
        XCTAssertEqual(state.ready(id: "s")["settings"] as? NSDictionary, ControlSettings().dictionary as NSDictionary)
    }
}
