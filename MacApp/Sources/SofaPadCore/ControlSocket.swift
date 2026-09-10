import Foundation
import NIOCore
import NIOWebSocket

final class ControlSocket: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = WebSocketFrame
    typealias OutboundOut = WebSocketFrame
    private let state: ControlState
    private let token: String?
    private var id: String?
    private var ready = false
    private var lastMessage = ProcessInfo.processInfo.systemUptime
    private var started = ProcessInfo.processInfo.systemUptime
    private var heartbeat: RepeatedTask?
    private var lastPermission: Bool?
    private var closed = false
    init(state: ControlState, token: String?) { self.state = state; self.token = token }
    func handlerAdded(context: ChannelHandlerContext) {
        let channel = context.channel
        let session = state.acquire(token: token) { reason in
            channel.eventLoop.execute { [weak self] in
                self?.end(channel, reason: reason)
            }
        }
        guard let id = session.id else { return end(channel, reason: session.error ?? "unpaired") }
        self.id = id
        heartbeat = context.eventLoop.scheduleRepeatedTask(initialDelay: .seconds(1), delay: .seconds(1)) { [weak self] _ in
            guard let self, !self.closed else { return }
            let now = ProcessInfo.processInfo.systemUptime
            if now - self.lastMessage > 6 || (!self.ready && now - self.started > 3) {
                return self.end(channel, reason: "timeout")
            }
            let permitted = self.state.snapshot().permitted
            if self.ready, permitted != self.lastPermission {
                self.lastPermission = permitted
                self.send(channel, ["type": "status", "permitted": permitted])
            }
        }
    }
    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        guard !closed else { return }
        let frame = unwrapInboundIn(data)
        var payload = frame.unmaskedData
        switch frame.opcode {
        case .connectionClose: end(context.channel, reason: "client_disconnect")
        case .ping:
            let pong = WebSocketFrame(fin: true, opcode: .pong, data: payload)
            context.writeAndFlush(wrapOutboundOut(pong), promise: nil)
        case .pong: break
        case .text:
            guard payload.readableBytes <= 16_384 else { return end(context.channel, reason: "protocol") }
            let data = Data(payload.readBytes(length: payload.readableBytes) ?? [])
            guard String(data: data, encoding: .utf8) != nil else { return end(context.channel, reason: "protocol") }
            receive(data, channel: context.channel)
        default: end(context.channel, reason: "protocol")
        }
    }
    private func receive(_ data: Data, channel: Channel) {
        guard let id else { return }
        if !ready {
            struct Hello: Decodable { let type: String; let v: Int }
            guard let hello = try? JSONDecoder().decode(Hello.self, from: data),
                  hello.type == "hello", hello.v == WireProtocol.version else {
                return end(channel, reason: "version")
            }
            ready = true; lastMessage = ProcessInfo.processInfo.systemUptime
            lastPermission = state.snapshot().permitted
            return send(channel, state.ready(id: id))
        }
        do {
            let message = try state.process(data, sessionID: id)
            lastMessage = ProcessInfo.processInfo.systemUptime
            if message.type == "ping" { send(channel, ["type": "pong", "nonce": message.nonce ?? ""]) }
            if message.type == "paste" { send(channel, state.paste(message, sessionID: id)) }
            if message.type == "disconnect" { end(channel, reason: "client_disconnect") }
        } catch { end(channel, reason: "protocol") }
    }
    private func send(_ channel: Channel, _ value: [String: Any]) {
        guard !closed, channel.isWritable, let bytes = try? JSONSerialization.data(withJSONObject: value) else {
            channel.close(promise: nil); return
        }
        var buffer = channel.allocator.buffer(capacity: bytes.count); buffer.writeBytes(bytes)
        channel.writeAndFlush(WebSocketFrame(fin: true, opcode: .text, data: buffer), promise: nil)
    }
    private func end(_ channel: Channel, reason: String) {
        guard !closed else { return }
        send(channel, ["type": "disconnect", "reason": reason]); closed = true
        heartbeat?.cancel()
        if let id { state.release(id: id) }
        var payload = channel.allocator.buffer(capacity: 2); payload.writeInteger(UInt16(1000))
        channel.writeAndFlush(WebSocketFrame(fin: true, opcode: .connectionClose, data: payload)).whenComplete { _ in channel.close(promise: nil) }
        channel.eventLoop.scheduleTask(in: .seconds(1)) { channel.close(promise: nil) }
    }
    func channelWritabilityChanged(context: ChannelHandlerContext) {
        if !context.channel.isWritable { end(context.channel, reason: "congested") }
        context.fireChannelWritabilityChanged()
    }
    func channelInactive(context: ChannelHandlerContext) {
        closed = true; heartbeat?.cancel(); if let id { state.release(id: id) }
        context.fireChannelInactive()
    }
    func errorCaught(context: ChannelHandlerContext, error: Error) { end(context.channel, reason: "protocol") }
}

/// Application limits around the library's frame decoder/aggregator.
final class WebSocketFrameGuard: ChannelInboundHandler {
    typealias InboundIn = WebSocketFrame
    private var start = ProcessInfo.processInfo.systemUptime
    private var count = 0
    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        let frame = unwrapInboundIn(data), now = ProcessInfo.processInfo.systemUptime
        if now - start >= 1 { start = now; count = 0 }
        count += 1
        guard frame.maskKey != nil, !frame.rsv1, !frame.rsv2, !frame.rsv3, count <= 480 else {
            context.fireErrorCaught(ProtocolFailure.invalid); return
        }
        context.fireChannelRead(data)
    }
}
