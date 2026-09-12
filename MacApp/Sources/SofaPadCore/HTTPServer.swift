import Foundation
import NIOCore
import NIOPosix
import NIOHTTP1
import NIOWebSocket

public final class LocalServer: @unchecked Sendable {
    private var group: MultiThreadedEventLoopGroup?
    private var listener: Channel?
    private let state: ControlState
    public init(state: ControlState) { self.state = state }

    /// Start/stop must be called on the same background queue, never the UI thread.
    public func start(address: String, port: Int, hostname: String? = nil, webRoot: URL) throws {
        let files = try WebFiles(root: webRoot)
        // Both the IP and the Bonjour name are accepted; only bound names, so a page
        // from anywhere else can never reach the socket.
        var hosts: Set<String> = ["\(address):\(port)"]
        if let hostname { hosts.insert("\(hostname):\(port)") }
        let policy = AccessPolicy(hosts: hosts)
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
                    let upgrader = NIOWebSocketServerUpgrader(maxFrameSize: 16_384, shouldUpgrade: { _, request in
                        let accepted = request.method == .GET && request.uri == "/ws" && validRequest(request, policy: policy, requiresOrigin: true)
                        return channel.eventLoop.makeSucceededFuture(accepted ? HTTPHeaders() : nil)
                    }, upgradePipelineHandler: { channel, request in
                        channel.eventLoop.makeCompletedFuture {
                            try channel.pipeline.syncOperations.addHandlers(WebSocketFrameGuard(),
                                NIOWebSocketFrameAggregator(minNonFinalFragmentSize: 1, maxAccumulatedFrameCount: 64, maxAccumulatedFrameSize: 16_384),
                                ControlSocket(state: state, label: AccessPolicy.clientLabel(userAgent: singleHeader(request, "User-Agent"))))
                        }
                    })
                    return channel.pipeline.configureHTTPServerPipeline(withServerUpgrade: (
                        upgraders: [upgrader], completionHandler: { context in
                            context.pipeline.removeHandler(http, promise: nil)
                        }
                    )).flatMap { channel.pipeline.addHandler(http) }
                }.bind(host: address, port: port).wait()
        } catch {
            try? group.syncShutdownGracefully(); self.group = nil; throw error
        }
    }
    public func stop() {
        state.disconnect(reason: "host_stopped")
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

enum WebFilesError: Error, CustomStringConvertible {
    case missing(String)
    var description: String {
        switch self { case .missing(let file): return "网页资源缺少 \(file)，请重新构建 App" }
    }
}

final class WebFiles: @unchecked Sendable {
    let assets: [String: (Data, String)]
    /// Serve whatever the web build produced instead of a fixed list: a new module used to
    /// be answered with 404 while the rest of the page loaded, so the app looked connected
    /// but stayed stuck on "正在连接 Mac…". Only real files of known types are exposed.
    init(root: URL) throws {
        var assets: [String: (Data, String)] = [:]
        let entries = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isRegularFileKey])
        for entry in entries {
            guard try entry.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true,
                  let type = Self.contentType(for: entry.lastPathComponent) else { continue }
            assets["/\(entry.lastPathComponent)"] = (try Data(contentsOf: entry), type)
        }
        for required in ["index.html", "style.css", "app.js"] where assets["/\(required)"] == nil {
            throw WebFilesError.missing(required)
        }
        assets["/"] = assets["/index.html"]; self.assets = assets
    }
    private static func contentType(for file: String) -> String? {
        if file.hasSuffix(".html") { return "text/html; charset=utf-8" }
        if file.hasSuffix(".css") { return "text/css; charset=utf-8" }
        if file.hasSuffix(".js") { return "text/javascript; charset=utf-8" }
        return nil
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
        if request.method == .GET, let (data, type) = files.assets[request.uri] {
            return respond(context, status: .ok, data: data, type: type)
        }
        if request.method == .GET, request.uri == "/api/status" {
            let snapshot = state.snapshot()
            return json(context, status: .ok, ["name": state.name, "permitted": snapshot.permitted,
                "controllers": snapshot.controllers.count, "preview": state.preview, "v": WireProtocol.version])
        }
        json(context, status: .notFound, ["error": "not_found"])
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
        let sockets = policy.hosts.sorted().map { "ws://\($0)" }.joined(separator: " ")
        headers.add(name: "Content-Security-Policy", value: "default-src 'self'; connect-src 'self' \(sockets); img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        context.write(wrapOutboundOut(.head(HTTPResponseHead(version: .http1_1, status: status, headers: headers))), promise: nil)
        var buffer = context.channel.allocator.buffer(capacity: data.count); buffer.writeBytes(data)
        context.write(wrapOutboundOut(.body(.byteBuffer(buffer))), promise: nil)
        context.writeAndFlush(wrapOutboundOut(.end(nil))).whenComplete { _ in context.close(promise: nil) }
    }
    func errorCaught(context: ChannelHandlerContext, error: Error) { context.close(promise: nil) }
}
