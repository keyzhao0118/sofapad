import Foundation

public struct ControlSettings: Codable, Equatable {
    public var pointer: Double = 1.5
    public var scroll: Double = 0.3
    public var natural: Bool = true
    public var keepAwake: Bool = true
    var dictionary: [String: Any] {
        ["pointer": pointer, "scroll": scroll, "natural": natural, "keepAwake": keepAwake]
    }
    var valid: Bool { (0.2...5).contains(pointer) && (0.05...5).contains(scroll) }
    mutating func apply(_ patch: SettingsPatch) {
        if let value = patch.pointer { pointer = value }
        if let value = patch.scroll { scroll = value }
        if let value = patch.natural { natural = value }
        if let value = patch.keepAwake { keepAwake = value }
    }
}

public struct SettingsPatch: Decodable {
    let pointer: Double?
    let scroll: Double?
    let natural: Bool?
    let keepAwake: Bool?
    var valid: Bool {
        (pointer != nil || scroll != nil || natural != nil || keepAwake != nil)
        && (pointer.map { $0.isFinite && (0.2...5).contains($0) } ?? true)
        && (scroll.map { $0.isFinite && (0.05...5).contains($0) } ?? true)
    }
}
