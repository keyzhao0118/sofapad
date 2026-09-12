import Foundation
import SystemConfiguration

struct NetworkAddress: Identifiable, Equatable {
    let ip: String
    var id: String { ip }
    /// The Mac's Bonjour name, for example "mac-mini.local". This one stays the same
    /// even when the router hands out a different IP, so it is the address to keep.
    static var hostname: String? {
        guard let name = SCDynamicStoreCopyLocalHostName(nil) as? String, !name.isEmpty else { return nil }
        return name.lowercased() + ".local"
    }
    static func available() -> [NetworkAddress] {
        var pointer: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&pointer) == 0, let first = pointer else { return [] }
        defer { freeifaddrs(pointer) }
        var result: [NetworkAddress] = []
        var next: UnsafeMutablePointer<ifaddrs>? = first
        while let current = next {
            defer { next = current.pointee.ifa_next }
            let value = current.pointee, name = String(cString: value.ifa_name)
            guard name.hasPrefix("en"), value.ifa_flags & UInt32(IFF_UP) != 0,
                  let addr = value.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(addr, socklen_t(addr.pointee.sa_len), &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 else { continue }
            let ip = String(cString: buffer), parts = ip.split(separator: ".").compactMap { Int($0) }
            guard parts.count == 4,
                  parts[0] == 10 || (parts[0] == 192 && parts[1] == 168) || (parts[0] == 172 && (16...31).contains(parts[1])) else { continue }
            result.append(NetworkAddress(ip: ip))
        }
        return result.sorted { $0.ip < $1.ip }
    }
}
