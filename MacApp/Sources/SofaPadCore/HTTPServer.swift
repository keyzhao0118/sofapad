import Foundation
import NIOCore
import NIOPosix
import NIOHTTP1
import NIOWebSocket
import NIOSSL

public final class LocalServer: @unchecked Sendable {
    private var group: MultiThreadedEventLoopGroup?
    private var listener: Channel?
    private let state: ControlState
    public init(state: ControlState) { self.state = state }

    /// Start/stop must be called on the same background queue, never the UI thread.
    public func start(address: String, port: Int, hostname: String?, webRoot: URL, tls: ServerTLS? = nil) throws {
        let files = try WebFiles(root: webRoot)
        var hosts: Set<String> = ["\(address):\(port)"]
        if let hostname { hosts.insert("\(hostname):\(port)") }
        let policy = AccessPolicy(hosts: hosts, secure: tls != nil)
        let sslContext = try tls?.context()
        let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
        self.group = group
        let state = self.state
        do {
            listener = try ServerBootstrap(group: group)
                .serverChannelOption(ChannelOptions.backlog, value: 32)
                .serverChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
                .childChannelOption(ChannelOptions.socketOption(.tcp_nodelay), value: 1)
                .childChannelOption(ChannelOptions.writeBufferWaterMark, value: .init(low: 16_384, high: 65_536))
                .childChannelInitializer { channel in
                    guard state.admitConnection() else { return channel.close() }
                    channel.closeFuture.whenComplete { _ in state.removeConnection() }
                    let http = HTTPHandler(state: state, policy: policy, files: files)
                    let upgrader = NIOWebSocketServerUpgrader(maxFrameSize: 16_384, shouldUpgrade: { channel, request in
                        let accepted = request.method == .GET && request.uri == "/ws" &&
                            validRequest(request, policy: policy, requiresOrigin: true) &&
                            state.authenticated(AccessPolicy.credential(cookie: singleHeader(request, "Cookie"), secure: policy.secure))
                        return channel.eventLoop.makeSucceededFuture(accepted ? HTTPHeaders() : nil)
                    }, upgradePipelineHandler: { channel, request in
                        channel.eventLoop.makeCompletedFuture {
                            try channel.pipeline.syncOperations.addHandlers(WebSocketFrameGuard(),
                                NIOWebSocketFrameAggregator(minNonFinalFragmentSize: 1, maxAccumulatedFrameCount: 64, maxAccumulatedFrameSize: 16_384),
                                ControlSocket(state: state, token: AccessPolicy.credential(cookie: singleHeader(request, "Cookie"), secure: policy.secure)))
                        }
                    })
                    let secured = channel.eventLoop.makeCompletedFuture {
                        if let sslContext { try channel.pipeline.syncOperations.addHandler(NIOSSLServerHandler(context: sslContext)) }
                    }
                    return secured.flatMap { channel.pipeline.configureHTTPServerPipeline(withServerUpgrade: (
                        upgraders: [upgrader], completionHandler: { context in
                            context.pipeline.removeHandler(http, promise: nil)
                        }
                    )) }.flatMap { channel.pipeline.addHandler(http) }
                }.bind(host: address, port: port).wait()
        } catch {
            try? group.syncShutdownGracefully(); self.group = nil; throw error
        }
    }
    public func stop() {
        state.closePairing(); state.disconnect(reason: "host_stopped")
        try? listener?.close().wait(); listener = nil
        try? group?.syncShutdownGracefully(); group = nil
    }
    public var port: Int? { listener?.localAddress?.port }
}

func singleHeader(_ request: HTTPRequestHead, _ name: String) -> String? {
    let values = request.headers[name]
    return values.count == 1 ? values.first : nil
}
func validRequest(_ request: HTTPRequestHead, policy: AccessPolicy, requiresOrigin: Bool) -> Bool {
    guard request.headers["Origin"].count <= 1,
          singleHeader(request, "Sec-Fetch-Site") != "cross-site" else { return false }
    return policy.accepts(host: singleHeader(request, "Host"), origin: singleHeader(request, "Origin"), requiresOrigin: requiresOrigin)
}

final class WebFiles: @unchecked Sendable {
    let assets: [String: (Data, String)]
    init(root: URL) throws {
        var assets: [String: (Data, String)] = [:]
        for file in ["index.html", "style.css", "app.js", "gesture.js", "connection.js", "text-input.js"] {
            let type = file.hasSuffix("html") ? "text/html; charset=utf-8" : file.hasSuffix("css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8"
            assets["/\(file)"] = (try Data(contentsOf: root.appendingPathComponent(file)), type)
        }
        assets["/"] = assets["/index.html"]; self.assets = assets
    }
}

final class HTTPHandler: ChannelInboundHandler, RemovableChannelHandler, @unchecked Sendable {
    typealias InboundIn = HTTPServerRequestPart
    typealias OutboundOut = HTTPServerResponsePart
    private let state: ControlState
    private let policy: AccessPolicy
    private let files: WebFiles
    private var request: HTTPRequestHead?
    private var body = Data()
    private var responded = false
    private var deadline: Scheduled<Void>?
    init(state: ControlState, policy: AccessPolicy, files: WebFiles) {
        self.state = state; self.policy = policy; self.files = files
    }
    func handlerAdded(context: ChannelHandlerContext) {
        let channel = context.channel
        deadline = context.eventLoop.scheduleTask(in: .seconds(10)) { channel.close(promise: nil) }
    }
    func handlerRemoved(context: ChannelHandlerContext) { deadline?.cancel() }
    func channelInactive(context: ChannelHandlerContext) { deadline?.cancel(); context.fireChannelInactive() }
    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        guard !responded else { return }
        switch unwrapInboundIn(data) {
        case .head(let request):
            self.request = request
            guard validRequest(request, policy: policy, requiresOrigin: request.method != .GET) else {
                return json(context, status: .forbidden, ["error": "forbidden"])
            }
            if let length = singleHeader(request, "Content-Length"), (Int(length) ?? Int.max) > 16_384 {
                return json(context, status: .payloadTooLarge, ["error": "too_large"])
            }
        case .body(var buffer):
            guard body.count + buffer.readableBytes <= 16_384 else {
                return json(context, status: .payloadTooLarge, ["error": "too_large"])
            }
            if let bytes = buffer.readBytes(length: buffer.readableBytes) { body.append(contentsOf: bytes) }
        case .end:
            guard let request else { return context.close(promise: nil) }
            route(context, request: request)
        }
    }
    private func route(_ context: ChannelHandlerContext, request: HTTPRequestHead) {
        let cookie = AccessPolicy.credential(cookie: singleHeader(request, "Cookie"), secure: policy.secure)
        if request.method == .GET, let (data, type) = files.assets[request.uri] {
            return respond(context, status: .ok, data: data, type: type)
        }
        if request.method == .GET, request.uri == "/api/status" {
            let authenticated = state.authenticated(cookie), snapshot = state.snapshot()
            return json(context, status: .ok, ["name": state.name, "authenticated": authenticated,
                "busy": snapshot.activeName != nil, "permitted": snapshot.permitted, "preview": state.preview, "v": WireProtocol.version])
        }
        if request.method == .POST, request.uri == "/api/pair" {
            struct PairRequest: Decodable { let token: String; let name: String }
            guard singleHeader(request, "Content-Type")?.split(separator: ";").first == "application/json",
                  let pair = try? JSONDecoder().decode(PairRequest.self, from: body) else {
                return json(context, status: .badRequest, ["error": "invalid"])
            }
            do {
                let token = try state.pair(token: pair.token, name: pair.name, peer: context.remoteAddress?.ipAddress ?? "unknown")
                json(context, status: .ok, ["paired": true], headers: [("Set-Cookie", "\(policy.cookieName)=\(token); HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000\(policy.secure ? "; Secure" : "")")])
            } catch PairingError.rateLimited { json(context, status: .tooManyRequests, ["error": "rate_limited"])
            } catch PairingError.storage { json(context, status: .internalServerError, ["error": "storage"])
            } catch { json(context, status: .forbidden, ["error": "pairing_expired"]) }
            return
        }
        if request.method == .POST, request.uri == "/api/forget" {
            do {
                try state.forget(token: cookie)
                json(context, status: .ok, ["forgotten": true], headers: [("Set-Cookie", "\(policy.cookieName)=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0\(policy.secure ? "; Secure" : "")")])
            } catch { json(context, status: .internalServerError, ["error": "storage"]) }
            return
        }
        json(context, status: request.uri == "/ws" ? .unauthorized : .notFound, ["error": request.uri == "/ws" ? "unpaired" : "not_found"])
    }
    private func json(_ context: ChannelHandlerContext, status: HTTPResponseStatus, _ value: [String: Any], headers: [(String, String)] = []) {
        respond(context, status: status, data: (try? JSONSerialization.data(withJSONObject: value)) ?? Data(),
                type: "application/json", headers: headers)
    }
    private func respond(_ context: ChannelHandlerContext, status: HTTPResponseStatus, data: Data, type: String, headers extra: [(String, String)] = []) {
        guard !responded else { return }; responded = true
        var headers = HTTPHeaders(extra)
        headers.add(name: "Content-Type", value: type); headers.add(name: "Content-Length", value: "\(data.count)")
        headers.add(name: "Connection", value: "close"); headers.add(name: "Cache-Control", value: "no-store")
        headers.add(name: "X-Content-Type-Options", value: "nosniff"); headers.add(name: "Referrer-Policy", value: "no-referrer")
        headers.add(name: "X-Frame-Options", value: "DENY")
        let sockets = policy.hosts.sorted().map { "\(policy.secure ? "wss" : "ws")://\($0)" }.joined(separator: " ")
        headers.add(name: "Content-Security-Policy", value: "default-src 'self'; connect-src 'self' \(sockets); img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        context.write(wrapOutboundOut(.head(HTTPResponseHead(version: .http1_1, status: status, headers: headers))), promise: nil)
        var buffer = context.channel.allocator.buffer(capacity: data.count); buffer.writeBytes(data)
        context.write(wrapOutboundOut(.body(.byteBuffer(buffer))), promise: nil)
        context.writeAndFlush(wrapOutboundOut(.end(nil))).whenComplete { _ in context.close(promise: nil) }
    }
    func errorCaught(context: ChannelHandlerContext, error: Error) { context.close(promise: nil) }
}
