import XCTest
@testable import SofaPadCore

final class CoreTests: XCTestCase {
    func testExactHostAndOriginPolicy() {
        let policy = AccessPolicy(hosts: ["192.168.1.4:9876"])
        XCTAssertTrue(policy.accepts(host: "192.168.1.4:9876", origin: "http://192.168.1.4:9876", requiresOrigin: true))
        for origin in [nil, "null", "https://192.168.1.4:9876", "http://evil.example", "http://192.168.1.4:9876.evil.example"] {
            XCTAssertFalse(policy.accepts(host: "192.168.1.4:9876", origin: origin, requiresOrigin: true))
        }
        XCTAssertFalse(policy.accepts(host: "evil.example:9876", origin: nil, requiresOrigin: false))
        XCTAssertTrue(policy.accepts(host: "192.168.1.4:9876", origin: nil, requiresOrigin: false))
        // The Bonjour name is allowed as a second, stable address next to the IP.
        let dual = AccessPolicy(hosts: ["192.168.1.4:9876", "mac-mini.local:9876"])
        XCTAssertTrue(dual.accepts(host: "mac-mini.local:9876", origin: "http://mac-mini.local:9876", requiresOrigin: true))
        XCTAssertTrue(dual.accepts(host: "192.168.1.4:9876", origin: "http://192.168.1.4:9876", requiresOrigin: true))
        XCTAssertFalse(dual.accepts(host: "other.local:9876", origin: "http://other.local:9876", requiresOrigin: true))
        XCTAssertEqual(AccessPolicy.clientLabel(userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari"), "iPhone Safari")
        XCTAssertEqual(AccessPolicy.clientLabel(userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari"), "Mac 浏览器")
        XCTAssertEqual(AccessPolicy.clientLabel(userAgent: nil), "手机")
    }
    func testServiceLaunchPolicy() {
        // Normal launch with an address ready.
        XCTAssertTrue(ServiceLaunchPolicy.shouldStart(running: false, changing: false, stoppedByUser: false,
                                                      hasAddress: true, addressAppeared: true, restartPending: false))
        // Logging in beats the network: the address shows up later and triggers the start.
        XCTAssertFalse(ServiceLaunchPolicy.shouldStart(running: false, changing: false, stoppedByUser: false,
                                                       hasAddress: false, addressAppeared: false, restartPending: false))
        XCTAssertTrue(ServiceLaunchPolicy.shouldStart(running: false, changing: false, stoppedByUser: false,
                                                      hasAddress: true, addressAppeared: true, restartPending: false))
        // A pending restart after an address change starts even without a fresh change.
        XCTAssertTrue(ServiceLaunchPolicy.shouldStart(running: false, changing: false, stoppedByUser: false,
                                                      hasAddress: true, addressAppeared: false, restartPending: true))
        // An explicit stop is respected, and nothing starts twice.
        XCTAssertFalse(ServiceLaunchPolicy.shouldStart(running: false, changing: false, stoppedByUser: true,
                                                       hasAddress: true, addressAppeared: true, restartPending: true))
        XCTAssertFalse(ServiceLaunchPolicy.shouldStart(running: true, changing: false, stoppedByUser: false,
                                                       hasAddress: true, addressAppeared: true, restartPending: false))
        XCTAssertFalse(ServiceLaunchPolicy.shouldStart(running: false, changing: true, stoppedByUser: false,
                                                       hasAddress: true, addressAppeared: true, restartPending: false))
    }
    func testSharedProtocolFixtures() throws {
        struct Fixture: Decodable { let name: String; let valid: Bool; let messages: [String] }
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: root.appendingPathComponent("Protocol/fixtures/messages.json")))
        for fixture in fixtures {
            var validator = ProtocolValidator(sessionID: "test-session"), accepted = true
            do { for message in fixture.messages { _ = try validator.validate(Data(message.utf8), now: 100) } }
            catch { accepted = false }
            XCTAssertEqual(accepted, fixture.valid, fixture.name)
        }
    }
    func testEveryConnectionControlsInParallel() throws {
        final class Fake: InputExecutor {
            var permitted = true; var doubleClickInterval = 0.5; var events = 0
            func execute(_ message: InputMessage) { events += 1 }; func reset() {}
        }
        let fake = Fake(), state = ControlState(executor: fake, name: "Test")
        var firstReason: String?, secondReason: String?
        let first = state.acquire(label: "iPhone Safari", disconnect: { firstReason = $0 })
        let second = state.acquire(label: "iPad Safari", disconnect: { secondReason = $0 })
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(state.snapshot().controllers, ["iPhone Safari", "iPad Safari"])
        func move(_ session: String, _ seq: Int) -> Data { Data("{\"type\":\"move\",\"v\":2,\"sessionID\":\"\(session)\",\"seq\":\(seq),\"dx\":1,\"dy\":2}".utf8) }
        // Both sessions are executed, each with its own sequence counter.
        _ = try state.process(move(first, 1), sessionID: first); XCTAssertEqual(fake.events, 1)
        _ = try state.process(move(second, 1), sessionID: second); XCTAssertEqual(fake.events, 2)
        // Without the accessibility grant input is ignored, but sessions survive.
        fake.permitted = false; _ = try state.process(move(first, 2), sessionID: first); XCTAssertEqual(fake.events, 2)
        XCTAssertEqual(state.snapshot().permitted, false)
        fake.permitted = true
        // One browser leaving does not disturb the other.
        state.release(id: first)
        XCTAssertEqual(state.snapshot().controllers, ["iPad Safari"])
        _ = try state.process(move(second, 2), sessionID: second); XCTAssertEqual(fake.events, 3)
        XCTAssertThrowsError(try state.process(move(first, 3), sessionID: first))
        // The Mac can still drop everyone at once.
        state.disconnect()
        XCTAssertEqual(secondReason, "host_disconnect"); XCTAssertNil(firstReason)
        XCTAssertTrue(state.snapshot().controllers.isEmpty)
        XCTAssertThrowsError(try state.process(move(second, 3), sessionID: second))
    }
    func testProtocolRateAndSizeLimits() throws {
        var validator = ProtocolValidator(sessionID: "test-session")
        for seq in 1...240 {
            _ = try validator.validate(Data("{\"type\":\"ping\",\"v\":2,\"sessionID\":\"test-session\",\"seq\":\(seq),\"nonce\":\"x\"}".utf8), now: 1)
        }
        XCTAssertThrowsError(try validator.validate(Data("{\"type\":\"ping\",\"v\":2,\"sessionID\":\"test-session\",\"seq\":241,\"nonce\":\"x\"}".utf8), now: 1))
        XCTAssertThrowsError(try validator.validate(Data(repeating: 32, count: 16_385), now: 2))
    }
}
