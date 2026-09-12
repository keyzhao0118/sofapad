import Foundation
import CryptoKit

public struct ControlSnapshot {
    /// One label per connected browser, in connection order.
    public let controllers: [String]
    public let permitted: Bool
}

/// Every connection gets its own session, so several phones can control the Mac at
/// the same time. Input is serialised by one lock and one executor; whichever gesture
/// starts first owns the pointer until it ends.
public final class ControlState: @unchecked Sendable {
    private let lock = NSRecursiveLock()
    private let executor: InputExecutor
    private var sessions: [(id: String, label: String, validator: ProtocolValidator, disconnect: (String) -> Void)] = []
    private var gestureOwner: String?
    private var connections = 0
    private var suspended = false
    private let pasteEpoch = UUID().uuidString
    private var pasteReceipts: [String: (hash: SHA256.Digest, status: String)] = [:]
    public let name: String
    public let preview: Bool
    public init(executor: InputExecutor, name: String, preview: Bool = false) {
        self.executor = executor; self.name = name; self.preview = preview
    }
    private func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock(); defer { lock.unlock() }; return try body()
    }
    public func snapshot() -> ControlSnapshot { locked {
        if suspended || !executor.permitted { executor.reset() }
        return ControlSnapshot(controllers: sessions.map(\.label), permitted: !suspended && executor.permitted)
    } }
    public func admitConnection() -> Bool { locked {
        guard connections < 48 else { return false }; connections += 1; return true
    } }
    public func removeConnection() { locked { connections = max(0, connections - 1) } }
    public func acquire(label: String, disconnect: @escaping (String) -> Void) -> String { locked {
        let id = UUID().uuidString
        sessions.append((id, label, ProtocolValidator(sessionID: id), disconnect))
        return id
    } }
    public func release(id: String) { locked {
        guard let index = sessions.firstIndex(where: { $0.id == id }) else { return }
        sessions.remove(at: index)
        // Only the session that owns the pointer may drop a button it is holding.
        if gestureOwner == id || sessions.isEmpty {
            gestureOwner = nil
            executor.reset()
        }
    } }
    public func disconnect(reason: String = "host_disconnect") { locked {
        let callbacks = sessions.map(\.disconnect)
        sessions.removeAll(); gestureOwner = nil; executor.reset()
        for callback in callbacks { callback(reason) }
    } }
    public func setSuspended(_ value: Bool) { locked {
        suspended = value
        if value { disconnect(reason: "host_paused") }
    } }
    public func ready(id: String) -> [String: Any] { locked {
        ["type": "ready", "v": WireProtocol.version, "sessionID": id, "name": name, "pasteEpoch": pasteEpoch,
         "permitted": !suspended && executor.permitted, "doubleClickInterval": executor.doubleClickInterval,
         "preview": preview, "capabilities": ["backspace", "edit", "enter"]]
    } }
    public func process(_ data: Data, sessionID: String) throws -> InputMessage { try locked {
        guard let index = sessions.firstIndex(where: { $0.id == sessionID }) else { throw ProtocolFailure.stale }
        let message = try sessions[index].validator.validate(data, now: ProcessInfo.processInfo.systemUptime)
        if ["scroll", "drag"].contains(message.type) {
            let ending = ["end", "cancel"].contains(message.phase ?? "")
            if ending { if gestureOwner == sessionID { gestureOwner = nil } }
            else if gestureOwner == nil { gestureOwner = sessionID }
        }
        if ["move", "click", "scroll", "drag", "backspace", "enter", "edit"].contains(message.type) {
            guard !suspended, executor.permitted else { executor.reset(); return message }
            executor.execute(message)
        }
        return message
    } }
    /// Receipts survive socket reconnects, and a process restart changes the epoch so an
    /// old ID can never execute twice. Never evict an ID and then run it again.
    public func paste(_ message: InputMessage, sessionID: String) -> [String: Any] { locked {
        let id = message.requestID ?? ""
        func reply(_ status: String, duplicate: Bool = false) -> [String: Any] {
            ["type": "pasteResult", "requestID": id, "status": status, "duplicate": duplicate]
        }
        guard sessions.contains(where: { $0.id == sessionID }),
              let text = message.text, id.hasPrefix(pasteEpoch + ":") else { return reply("expired") }
        let hash = SHA256.hash(data: Data(text.utf8))
        if let receipt = pasteReceipts[id] {
            return reply(receipt.hash == hash ? receipt.status : "id_conflict", duplicate: true)
        }
        guard pasteReceipts.count < 1024 else { return reply("limit") }
        let status = !suspended && executor.permitted ? executor.paste(text) : "permission"
        pasteReceipts[id] = (hash, status)
        return reply(status)
    } }
}
