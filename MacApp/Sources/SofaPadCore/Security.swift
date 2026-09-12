import Foundation

/// Exact Host and Origin checks. Control is open to the local network, so the server
/// still refuses hosts it was not bound to and pages loaded from anywhere else.
public struct AccessPolicy: Sendable {
    public let hosts: Set<String>
    public init(hosts: Set<String>) { self.hosts = hosts }
    public func accepts(host: String?, origin: String?, requiresOrigin: Bool) -> Bool {
        guard let host, hosts.contains(host) else { return false }
        guard let origin else { return !requiresOrigin }
        guard origin.hasPrefix("http://") else { return false }
        return hosts.contains(String(origin.dropFirst("http://".count)))
    }
    /// A short label for the menu bar, derived from the browser that connected.
    public static func clientLabel(userAgent: String?) -> String {
        guard let userAgent else { return "手机" }
        if userAgent.contains("iPhone") { return "iPhone Safari" }
        if userAgent.contains("iPad") { return "iPad Safari" }
        if userAgent.contains("Macintosh") { return "Mac 浏览器" }
        return "浏览器"
    }
}
