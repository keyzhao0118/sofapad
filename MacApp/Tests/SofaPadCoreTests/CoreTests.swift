import XCTest
@testable import SofaPadCore

final class CoreTests: XCTestCase {
    func testPairingOneTimeExpiryAndRevocation() throws {
        let store = try CredentialStore(file: nil), now = Date()
        let token = try store.beginPairing(now: now)
        XCTAssertEqual(token.count, 43)
        let credential = try store.pair(token: token, name: "iPhone", peer: "phone", now: now)
        XCTAssertThrowsError(try store.pair(token: token, name: "iPhone", peer: "phone", now: now))
        let device = try XCTUnwrap(store.authenticate(credential, now: now))
        XCTAssertNil(store.authenticate(credential, now: now.addingTimeInterval(31 * 86400)))
        try store.revoke(id: device.id); XCTAssertNil(store.authenticate(credential, now: now))
        let expired = try store.beginPairing(now: now)
        XCTAssertThrowsError(try store.pair(token: expired, name: "iPhone", peer: "phone", now: now.addingTimeInterval(301)))
        _ = try store.beginPairing(); store.closePairing()
        XCTAssertThrowsError(try store.pair(token: expired, name: "iPhone", peer: "phone"))
    }
    func testCredentialsPersistOnlyHashes() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("devices.json")
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let store = try CredentialStore(file: file)
        let token = try store.beginPairing(), credential = try store.pair(token: token, name: "Phone", peer: "1")
        let content = try String(contentsOf: file, encoding: .utf8)
        XCTAssertFalse(content.contains(credential)); XCTAssertFalse(content.contains(token))
        XCTAssertNotNil(try CredentialStore(file: file).authenticate(credential))
        XCTAssertEqual((try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? NSNumber)?.intValue, 0o600)
    }
    func testExactHostOriginAndCookiePolicy() {
        let policy = AccessPolicy(hosts: ["192.168.1.4:9876"])
        XCTAssertTrue(policy.accepts(host: "192.168.1.4:9876", origin: "http://192.168.1.4:9876", requiresOrigin: true))
        for origin in [nil, "null", "https://192.168.1.4:9876", "http://evil.example", "http://192.168.1.4:9876.evil.example"] {
            XCTAssertFalse(policy.accepts(host: "192.168.1.4:9876", origin: origin, requiresOrigin: true))
        }
        XCTAssertFalse(policy.accepts(host: "evil.example:9876", origin: nil, requiresOrigin: false))
        let cookie = "sofapad=" + String(repeating: "a", count: 43)
        XCTAssertNotNil(AccessPolicy.credential(cookie: cookie)); XCTAssertNil(AccessPolicy.credential(cookie: cookie + "; " + cookie))
    }
    func testPairingRateLimits() throws {
        let store = try CredentialStore(file: nil), token = try store.beginPairing()
        for _ in 0..<10 { XCTAssertThrowsError(try store.pair(token: "bad", name: "", peer: "same")) }
        XCTAssertThrowsError(try store.pair(token: token, name: "", peer: "same")) { error in
            guard case PairingError.rateLimited = error else { return XCTFail("Expected rate limit") }
        }
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
    func testSessionOwnershipPermissionAndRevocation() throws {
        final class Fake: InputExecutor {
            var permitted = true; var doubleClickInterval = 0.5; var events = 0
            func execute(_ message: InputMessage) { events += 1 }; func reset() {}
        }
        let store = try CredentialStore(file: nil), fake = Fake(), state = ControlState(store: store, executor: fake, name: "Test")
        let token = try state.beginPairing(), cookie = try state.pair(token: token, name: "Phone", peer: "1")
        XCTAssertEqual(state.acquire(token: nil, disconnect: { _ in }).error, "unpaired")
        var reason: String?
        let id = try XCTUnwrap(state.acquire(token: cookie, disconnect: { reason = $0 }).id)
        XCTAssertEqual(state.acquire(token: cookie, disconnect: { _ in }).error, "busy")
        func move(_ seq: Int) -> Data { Data("{\"type\":\"move\",\"v\":2,\"sessionID\":\"\(id)\",\"seq\":\(seq),\"dx\":1,\"dy\":2}".utf8) }
        _ = try state.process(move(1), sessionID: id); XCTAssertEqual(fake.events, 1)
        fake.permitted = false; _ = try state.process(move(2), sessionID: id); XCTAssertEqual(fake.events, 1)
        XCTAssertThrowsError(try state.process(move(2), sessionID: id))
        try state.revoke(id: XCTUnwrap(state.snapshot().devices.first).id)
        XCTAssertEqual(reason, "revoked"); XCTAssertThrowsError(try state.process(move(3), sessionID: id))
        XCTAssertFalse(state.authenticated(cookie))
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
