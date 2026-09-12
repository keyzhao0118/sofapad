// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SofaPad",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "SofaPad", targets: ["SofaPad"])],
    dependencies: [
        .package(url: "https://github.com/apple/swift-nio.git", exact: "2.102.0"),
    ],
    targets: [
        .target(name: "SofaPadCore", dependencies: [
            .product(name: "NIOCore", package: "swift-nio"),
            .product(name: "NIOPosix", package: "swift-nio"),
            .product(name: "NIOHTTP1", package: "swift-nio"),
            .product(name: "NIOWebSocket", package: "swift-nio"),
        ], path: "MacApp/Sources/SofaPadCore"),
        .executableTarget(name: "SofaPad", dependencies: ["SofaPadCore"], path: "MacApp/Sources/SofaPad"),
        .testTarget(name: "SofaPadCoreTests", dependencies: ["SofaPadCore"], path: "MacApp/Tests/SofaPadCoreTests"),
    ],
    swiftLanguageModes: [.v5]
)
