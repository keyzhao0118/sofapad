import SwiftUI
import AppKit
import CoreImage.CIFilterBuiltins
import SofaPadCore

@main enum EntryPoint {
    static func main() {
        if CommandLine.arguments.contains("--preview-server") { runPreview() }
        else { SofaPadApplication.main() }
    }
    private static func runPreview() {
        func argument(_ key: String) -> String? {
            guard let index = CommandLine.arguments.firstIndex(of: key), index + 1 < CommandLine.arguments.count else { return nil }
            return CommandLine.arguments[index + 1]
        }
        guard let root = argument("--web-root"), let output = argument("--pair-file"),
              let port = Int(argument("--port") ?? "19876"), (1024...65535).contains(port) else {
            fputs("Preview requires --web-root PATH --pair-file PATH [--port PORT]\n", stderr); exit(2)
        }
        do {
            let certificate = argument("--tls-cert"), key = argument("--tls-key")
            guard (certificate == nil) == (key == nil) else {
                fputs("Preview TLS requires both --tls-cert and --tls-key\n", stderr); exit(2)
            }
            let tls = certificate.flatMap { cert in key.map { ServerTLS(certificatePath: cert, privateKeyPath: $0) } }
            let state = ControlState(store: try CredentialStore(file: nil), executor: PreviewExecutor(), name: "SofaPad 演示 Mac", preview: true)
            let server = LocalServer(state: state)
            try server.start(address: "127.0.0.1", port: port, hostname: nil, webRoot: URL(fileURLWithPath: root), tls: tls)
            let token = try state.beginPairing()
            let payload = try JSONSerialization.data(withJSONObject: ["url": "\(argument("--tls-cert") == nil ? "http" : "https")://127.0.0.1:\(port)/#pair=\(token)", "pid": ProcessInfo.processInfo.processIdentifier])
            let url = URL(fileURLWithPath: output)
            FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600])
            try payload.write(to: url)
            print("Preview ready on loopback port \(port). System input is disabled.")
            signal(SIGINT, SIG_IGN); signal(SIGTERM, SIG_IGN)
            let stop = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
            let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
            stop.setEventHandler { server.stop(); exit(0) }; interrupt.setEventHandler { server.stop(); exit(0) }
            stop.resume(); interrupt.resume(); dispatchMain()
        } catch { fputs("Preview failed: \(error)\n", stderr); exit(1) }
    }
}

struct SofaPadApplication: App {
    @StateObject private var model = AppModel()
    var body: some Scene {
        Window("SofaPad · 从沙发掌控 Mac", id: "setup") {
            SetupView(model: model)
        }.defaultSize(width: 510, height: 540).windowResizability(.contentMinSize)
        MenuBarExtra("SofaPad", systemImage: model.activeName == nil ? "rectangle.and.hand.point.up.left" : "cursorarrow.rays") {
            MenuContent(model: model)
        }
    }
}

struct MenuContent: View {
    @ObservedObject var model: AppModel
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Text(model.running ? (model.activeName.map { "\($0) 正在控制" } ?? "等待手机连接") : "服务已关闭")
        Button("打开 SofaPad…") { openWindow(id: "setup"); NSApp.activate(ignoringOtherApps: true) }
        if model.running {
            Button("配对新浏览器…") { openWindow(id: "setup"); NSApp.activate(ignoringOtherApps: true); model.beginPairing() }
            Button("断开当前控制者") { model.disconnect() }.disabled(model.activeName == nil)
            Button("停止服务") { model.stop() }
        }
        Divider()
        Button("退出 SofaPad") { model.quit() }.keyboardShortcut("q")
    }
}

struct SetupView: View {
    @ObservedObject var model: AppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("SofaPad").font(.title2.bold())
                    Spacer()
                    Text(model.running ? (model.activeName ?? "等待手机") : "服务已关闭").font(.callout).foregroundStyle(.secondary)
                }
                if let error = model.error { Text(error).font(.callout).foregroundStyle(.orange).textSelection(.enabled) }
                if let url = model.accessURL {
                    Text(url.absoluteString).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                    Toggle("使用主机名", isOn: $model.useHostname).onChange(of: model.useHostname) { _ in model.changeURLMode() }
                    Text(model.secure ? "HTTPS / WSS · 请使用与证书匹配的地址" : "开发预览：HTTP 未加密，文字与凭据可被窃听").font(.caption).foregroundStyle(.secondary)
                }
                if let url = model.pairURL {
                    HStack(spacing: 18) {
                        QRView(url: url).frame(width: 170, height: 170)
                        VStack(alignment: .leading, spacing: 10) {
                            Text("用 iPhone 系统相机扫码")
                            if let expiry = model.pairExpiry { Text("有效期 \(expiry, style: .timer)").monospacedDigit() }
                            Button("复制配对链接") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(url.absoluteString, forType: .string) }
                        }.font(.callout)
                    }
                }
                HStack {
                    Button(model.running ? "停止服务" : "开启服务") { model.running ? model.stop() : model.start() }
                        .disabled(model.changing || (!model.running && !model.canStart))
                    Button(model.pairURL == nil ? "配对手机" : "关闭配对") { model.pairURL == nil ? model.beginPairing() : model.closePairing() }.disabled(!model.running)
                    if model.activeName != nil { Button("断开") { model.disconnect() } }
                }
                if !model.permitted { Button("授予辅助功能权限…") { model.authorize() } }
                DisclosureGroup("首次连接与授权") {
                    VStack(alignment: .leading, spacing: 12) {
                        Picker("网络地址", selection: $model.selectedAddress) {
                            if model.addresses.isEmpty { Text("无可用私有 IPv4").tag("") }
                            ForEach(model.addresses) { Text($0.label).tag($0.ip) }
                        }.disabled(model.running || model.changing)
                        Button(model.hasCertificate ? "更新 HTTPS 证书与私钥…" : "导入 HTTPS 证书与私钥…") { model.importTLS() }.disabled(model.running || model.changing)
                        Text("正式使用需 Safari 信任的 PEM 证书链与未加密 PEM 私钥，证书须覆盖访问的 IP 或主机名。App 不安装根证书，也不绕过浏览器验证。").font(.caption).foregroundStyle(.secondary)
                        Toggle("仅开发：允许未加密 HTTP（含文字和凭据）", isOn: $model.acceptedHTTP).disabled(model.running || model.changing)
                        Button("局域网权限…") { model.openSettings("Privacy_LocalNetwork") }
                        Toggle("登录时启动", isOn: Binding(get: { model.loginStatus == .enabled || model.loginStatus == .requiresApproval }, set: model.setLogin))
                        Text(model.loginLabel).font(.caption).foregroundStyle(.secondary)
                        Text("Mac 需已登录、解锁并保持唤醒。文字写入剪贴板后，仅向当前应用执行 Command + V；不会抢焦点、自动回车或恢复旧剪贴板。").font(.caption).foregroundStyle(.secondary)
                    }.padding(.top, 12)
                }
                if !model.devices.isEmpty {
                    DisclosureGroup("已配对浏览器") {
                        ForEach(model.devices) { device in
                            HStack { Text(device.name); Spacer(); Button("移除", role: .destructive) { model.revoke(device) } }.padding(.vertical, 5)
                        }
                    }
                }
                Text("0.2.0 · 触控与文字粘贴 · 无云服务").font(.caption).foregroundStyle(.secondary)
            }.padding(24)
        }.frame(minWidth: 460, minHeight: 380)
    }
}

struct QRView: View {
    let url: URL
    var body: some View {
        if let image = qrImage {
            Image(nsImage: image).interpolation(.none).resizable().scaledToFit().padding(10).background(.white).clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }
    private var qrImage: NSImage? {
        let filter = CIFilter.qrCodeGenerator(); filter.message = Data(url.absoluteString.utf8); filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 6, y: 6)),
              let image = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return NSImage(cgImage: image, size: NSSize(width: output.extent.width, height: output.extent.height))
    }
}
