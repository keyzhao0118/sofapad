import Foundation
import CryptoKit

public struct ControlSnapshot {
    public let devices: [PairedDevice]
    public let pairingExpiry: Date?
    public let activeName: String?
    public let permitted: Bool
}

public final class ControlState: @unchecked Sendable {
    private let lock = NSRecursiveLock()
    private let store: CredentialStore
    private let executor: InputExecutor
    private var active: (id: String, device: PairedDevice, validator: ProtocolValidator, disconnect: (String) -> Void)?
    private var connections = 0
    private var suspended = false
    private let pasteEpoch = UUID().uuidString
    private var pasteReceipts: [String: [String: (hash: SHA256.Digest, status: String)]] = [:]
    public let name: String
    public let preview: Bool
    public init(store: CredentialStore, executor: InputExecutor, name: String, preview: Bool = false) {
        self.store = store; self.executor = executor; self.name = name; self.preview = preview
    }
    private func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock(); defer { lock.unlock() }; return try body()
    }
    public func snapshot() -> ControlSnapshot { locked {
        if suspended || !executor.permitted { executor.reset() }
        return ControlSnapshot(devices: store.devices.filter { $0.expires > Date() }, pairingExpiry: store.pairingExpiry,
                        activeName: active?.device.name, permitted: !suspended && executor.permitted)
    } }
    public func beginPairing() throws -> String { try locked { try store.beginPairing() } }
    public func closePairing() { locked { store.closePairing() } }
    public func pair(token: String, name: String, peer: String) throws -> String {
        try locked { try store.pair(token: token, name: name, peer: peer) }
    }
    public func authenticated(_ token: String?) -> Bool { locked { store.authenticate(token) != nil } }
    public func revoke(id: String) throws { try locked {
        try store.revoke(id: id)
        pasteReceipts.removeValue(forKey: id)
        if active?.device.id == id { disconnect(reason: "revoked") }
    } }
    public func forget(token: String?) throws { try locked {
        guard let device = store.authenticate(token) else { return }
        try revoke(id: device.id)
    } }
    public func admitConnection() -> Bool { locked {
        guard connections < 48 else { return false }; connections += 1; return true
    } }
    public func removeConnection() { locked { connections = max(0, connections - 1) } }
    public func acquire(token: String?, disconnect: @escaping (String) -> Void) -> (id: String?, error: String?) { locked {
        guard let device = store.authenticate(token) else { return (nil, "unpaired") }
        guard active == nil else { return (nil, "busy") }
        let id = UUID().uuidString
        executor.reset()
        active = (id, device, ProtocolValidator(sessionID: id), disconnect)
        return (id, nil)
    } }
    public func release(id: String) { locked {
        guard active?.id == id else { return }; active = nil; executor.reset()
    } }
    public func disconnect(reason: String = "host_disconnect") { locked {
        let callback = active?.disconnect; active = nil; executor.reset(); callback?(reason)
    } }
    public func setSuspended(_ value: Bool) { locked {
        suspended = value
        if value { disconnect(reason: "host_paused") }
    } }
    public func ready(id: String) -> [String: Any] { locked {
        ["type": "ready", "v": WireProtocol.version, "sessionID": id, "name": name, "pasteEpoch": pasteEpoch,
         "permitted": !suspended && executor.permitted, "doubleClickInterval": executor.doubleClickInterval,
         "preview": preview, "capabilities": ["backspace"]]
    } }
    public func process(_ data: Data, sessionID: String) throws -> InputMessage { try locked {
        guard var session = active, session.id == sessionID, session.device.expires > Date() else { throw ProtocolFailure.stale }
        let message = try session.validator.validate(data, now: ProcessInfo.processInfo.systemUptime)
        active = session
        if ["move", "click", "scroll", "drag", "backspace"].contains(message.type) {
            guard !suspended, executor.permitted else { executor.reset(); return message }
            executor.execute(message)
        }
        return message
    } }
    /// Retain receipts across socket reconnects. Never evict IDs and then execute them again.
    /// A process restart changes the epoch, so old IDs cannot execute after restart either.
    public func paste(_ message: InputMessage, sessionID: String) -> [String: Any] { locked {
        let id = message.requestID ?? ""
        func reply(_ status: String, duplicate: Bool = false) -> [String: Any] {
            ["type": "pasteResult", "requestID": id, "status": status, "duplicate": duplicate]
        }
        guard let session = active, session.id == sessionID, session.device.expires > Date(),
              let text = message.text, id.hasPrefix(pasteEpoch + ":") else { return reply("expired") }
        let hash = SHA256.hash(data: Data(text.utf8)), deviceID = session.device.id
        if let receipt = pasteReceipts[deviceID]?[id] {
            return reply(receipt.hash == hash ? receipt.status : "id_conflict", duplicate: true)
        }
        guard (pasteReceipts[deviceID]?.count ?? 0) < 1024 else { return reply("limit") }
        let status = !suspended && executor.permitted ? executor.paste(text) : "permission"
        pasteReceipts[deviceID, default: [:]][id] = (hash, status)
        return reply(status)
    } }
}
