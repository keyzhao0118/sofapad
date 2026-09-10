import Foundation
import CryptoKit
import Security

public struct PairedDevice: Codable, Identifiable, Equatable {
    public let id: String
    public let name: String
    public let created: Date
    public let expires: Date
    let tokenHash: String
}

public enum PairingError: Error { case closed, invalid, rateLimited, storage, capacity }

public struct AccessPolicy: Sendable {
    public let hosts: Set<String>
    public let secure: Bool
    public var scheme: String { secure ? "https" : "http" }
    public var cookieName: String { secure ? "__Host-sofapad" : "sofapad" }
    public init(hosts: Set<String>, secure: Bool = false) { self.hosts = hosts; self.secure = secure }
    public func accepts(host: String?, origin: String?, requiresOrigin: Bool) -> Bool {
        guard let host, hosts.contains(host) else { return false }
        if let origin { return origin == "\(scheme)://\(host)" }
        return !requiresOrigin
    }
    public static func credential(cookie: String?, secure: Bool = false) -> String? {
        let values = (cookie ?? "").split(separator: ";").compactMap { part -> String? in
            let pair = part.trimmingCharacters(in: .whitespaces).split(separator: "=", maxSplits: 1)
            return pair.count == 2 && pair[0] == (secure ? "__Host-sofapad" : "sofapad") ? String(pair[1]) : nil
        }
        guard values.count == 1, values[0].count == 43 else { return nil }
        return values[0]
    }
}

/// Call under ControlState's lock. Only SHA-256 hashes are persisted.
public final class CredentialStore {
    private let file: URL?
    public private(set) var devices: [PairedDevice]
    private var pairing: (token: String, expires: Date)?
    private var attempts: [String: (start: Date, count: Int)] = [:]
    private var globalAttempts: (start: Date, count: Int) = (.distantPast, 0)

    public init(file: URL?) throws {
        self.file = file
        if let file, FileManager.default.fileExists(atPath: file.path) {
            devices = try JSONDecoder().decode([PairedDevice].self, from: Data(contentsOf: file))
        } else { devices = [] }
    }
    public var pairingExpiry: Date? { pairing?.expires }
    public func beginPairing(now: Date = Date()) throws -> String {
        let token = try Self.randomToken()
        pairing = (token, now.addingTimeInterval(300))
        return token
    }
    public func closePairing() { pairing = nil }
    public func pair(token: String, name: String, peer: String, now: Date = Date()) throws -> String {
        attempts = attempts.filter { now.timeIntervalSince($0.value.start) < 60 }
        if now.timeIntervalSince(globalAttempts.start) >= 60 { globalAttempts = (now, 0) }
        var attempt = attempts[peer] ?? (start: now, count: 0)
        guard attempt.count < 10, globalAttempts.count < 60 else { throw PairingError.rateLimited }
        attempt.count += 1; attempts[peer] = attempt; globalAttempts.count += 1
        guard let pairing, pairing.expires > now else { throw PairingError.closed }
        guard token.count == 43, Self.digest(token) == Self.digest(pairing.token) else { throw PairingError.invalid }
        let credential = try Self.randomToken()
        var updated = devices.filter { $0.expires > now }
        guard updated.count < 32 else { throw PairingError.capacity }
        let cleanName = String(String.UnicodeScalarView(name.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }))
        updated.append(PairedDevice(id: UUID().uuidString,
                                    name: String(cleanName.prefix(40)),
                                    created: now, expires: now.addingTimeInterval(30 * 86400), tokenHash: Self.digest(credential)))
        try save(updated)
        devices = updated; self.pairing = nil
        return credential
    }
    public func authenticate(_ token: String?, now: Date = Date()) -> PairedDevice? {
        guard let token, token.count == 43 else { return nil }
        let hash = Self.digest(token)
        return devices.first { $0.tokenHash == hash && $0.expires > now }
    }
    public func revoke(id: String) throws {
        let updated = devices.filter { $0.id != id }
        try save(updated); devices = updated
    }
    private func save(_ updated: [PairedDevice]) throws {
        guard let file else { return }
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            try JSONEncoder().encode(updated).write(to: file, options: [.atomic, .completeFileProtectionUnlessOpen])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        } catch { throw PairingError.storage }
    }
    private static func digest(_ token: String) -> String {
        SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private static func randomToken() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw PairingError.storage }
        return Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
