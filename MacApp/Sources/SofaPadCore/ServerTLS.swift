import Foundation
import NIOSSL

public struct ServerTLS: Sendable {
    public let certificatePath: String
    public let privateKeyPath: String
    public init(certificatePath: String, privateKeyPath: String) {
        self.certificatePath = certificatePath; self.privateKeyPath = privateKeyPath
    }
    public func validate() throws { _ = try context() }
    func context() throws -> NIOSSLContext {
        var config = TLSConfiguration.makeServerConfiguration(
            certificateChain: try NIOSSLCertificate.fromPEMFile(certificatePath).map { .certificate($0) },
            privateKey: .privateKey(try NIOSSLPrivateKey(file: privateKeyPath, format: .pem)))
        config.minimumTLSVersion = .tlsv12
        return try NIOSSLContext(configuration: config)
    }
}
