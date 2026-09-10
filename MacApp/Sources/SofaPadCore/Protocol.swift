import Foundation

public enum ProtocolFailure: Error, Equatable { case invalid, stale, rateLimited }
public enum WireProtocol { public static let version = 2; public static let maxTextBytes = 12_000 }

public struct InputMessage: Decodable {
    public let type: String
    public let v: Int
    public let sessionID: String?
    public let seq: Int?
    public let dx: Double?
    public let dy: Double?
    public let button: String?
    public let count: Int?
    public let phase: String?
    public let nonce: String?
    public let requestID: String?
    public let text: String?
}

/// One validator per socket. No queued input survives its lifetime.
public struct ProtocolValidator {
    public let sessionID: String
    private var sequence = 0
    private var scrolling = false
    private var dragging = false
    private var windowStart: TimeInterval = 0
    private var messageCount = 0
    public init(sessionID: String) { self.sessionID = sessionID }

    public mutating func validate(_ data: Data, now: TimeInterval) throws -> InputMessage {
        guard data.count <= 16_384,
              let message = try? JSONDecoder().decode(InputMessage.self, from: data),
              message.v == WireProtocol.version, message.sessionID == sessionID,
              let seq = message.seq, seq > sequence, seq <= 9_007_199_254_740_991 else {
            throw ProtocolFailure.stale
        }
        if now - windowStart >= 1 { windowStart = now; messageCount = 0 }
        messageCount += 1
        guard messageCount <= 240 else { throw ProtocolFailure.rateLimited }
        switch message.type {
        case "move", "scroll", "drag":
            guard let dx = message.dx, let dy = message.dy,
                  dx.isFinite, dy.isFinite, abs(dx) <= 2_000, abs(dy) <= 2_000 else {
                throw ProtocolFailure.invalid
            }
            if message.type == "scroll" {
                guard !dragging else { throw ProtocolFailure.invalid }
                switch message.phase {
                case "begin": guard !scrolling else { throw ProtocolFailure.invalid }; scrolling = true
                case "update": guard scrolling else { throw ProtocolFailure.invalid }
                case "end", "cancel":
                    guard scrolling, dx == 0, dy == 0 else { throw ProtocolFailure.invalid }
                    scrolling = false
                default: throw ProtocolFailure.invalid
                }
            } else if message.type == "drag" {
                guard !scrolling else { throw ProtocolFailure.invalid }
                switch message.phase {
                case "begin": guard !dragging else { throw ProtocolFailure.invalid }; dragging = true
                case "update": guard dragging else { throw ProtocolFailure.invalid }
                case "end", "cancel":
                    guard dragging, dx == 0, dy == 0 else { throw ProtocolFailure.invalid }
                    dragging = false
                default: throw ProtocolFailure.invalid
                }
            } else if scrolling || dragging { throw ProtocolFailure.invalid }
        case "click":
            guard !scrolling, !dragging, ["left", "right"].contains(message.button ?? ""),
                  [1, 2].contains(message.count ?? 0),
                  message.button != "right" || message.count == 1 else { throw ProtocolFailure.invalid }
        case "paste":
            guard !scrolling, !dragging, let text = message.text, !text.isEmpty,
                  text.utf8.count <= WireProtocol.maxTextBytes,
                  let id = message.requestID, (38...100).contains(id.utf8.count),
                  id.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 || $0 == 58 }) else {
                throw ProtocolFailure.invalid
            }
        case "ping":
            guard let nonce = message.nonce, nonce.count <= 64 else { throw ProtocolFailure.invalid }
        case "disconnect": break
        default: throw ProtocolFailure.invalid
        }
        sequence = seq
        return message
    }
}

public protocol InputExecutor: AnyObject {
    var permitted: Bool { get }
    var doubleClickInterval: Double { get }
    func execute(_ message: InputMessage)
    func reset()
    func paste(_ text: String) -> String
}

public extension InputExecutor { func paste(_ text: String) -> String { "unavailable" } }

public final class PreviewExecutor: InputExecutor {
    public var permitted: Bool { true }
    public var doubleClickInterval: Double { 0.5 }
    public private(set) var count = 0
    public init() {}
    public func execute(_ message: InputMessage) { count += 1 }
    public func reset() {}
    public func paste(_ text: String) -> String { count += 1; return "executed" }
}
