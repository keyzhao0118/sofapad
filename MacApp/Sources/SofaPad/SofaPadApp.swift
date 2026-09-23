import SwiftUI
import AppKit
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
        guard let root = argument("--web-root"), let output = argument("--info-file"),
              let port = Int(argument("--port") ?? "19876"), (1024...65535).contains(port) else {
            fputs("Preview requires --web-root PATH --info-file PATH [--port PORT]\n", stderr); exit(2)
        }
        do {
            let state = ControlState(executor: PreviewExecutor(), name: "SofaPad 演示 Mac", preview: true)
            let server = LocalServer(state: state)
            try server.start(address: "127.0.0.1", port: port, webRoot: URL(fileURLWithPath: root))
            let payload = try JSONSerialization.data(withJSONObject: ["url": "http://127.0.0.1:\(port)/", "pid": ProcessInfo.processInfo.processIdentifier])
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

/// The whole app is the menu bar: the service starts with it, and every setting fits
/// in this menu.
struct SofaPadApplication: App {
    @StateObject private var model = AppModel()
    private static let menuIcon: NSImage = {
        let size = NSSize(width: 18, height: 18)
        let image = NSImage(size: size)
        for name in ["MenuBarIcon", "MenuBarIcon@2x"] {
            // The 1x and 2x files are separate bitmaps; both are declared as 18 pt so
            // AppKit picks the right one per display.
            if let url = Bundle.main.url(forResource: name, withExtension: "png"),
               let data = try? Data(contentsOf: url),
               let representation = NSBitmapImageRep(data: data) {
                representation.size = size
                image.addRepresentation(representation)
            }
        }
        // The unbundled development executable has no resource directory.
        if image.representations.isEmpty {
            return NSImage(systemSymbolName: "cursorarrow", accessibilityDescription: "SofaPad")!
        }
        image.isTemplate = true
        return image
    }()
    var body: some Scene {
        MenuBarExtra {
            MenuContent(model: model)
        } label: {
            Image(nsImage: Self.menuIcon)
                .accessibilityLabel(model.controllers.isEmpty ? "SofaPad，未连接" : "SofaPad，已连接 \(model.controllers.count) 台设备")
        }
    }
}

struct MenuContent: View {
    @ObservedObject var model: AppModel
    /// Read from Info.plist so the menu cannot drift from the shipped bundle version.
    private static var versionLabel: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return version.map { "\($0) · 触控与文字粘贴 · 无云服务" } ?? "触控与文字粘贴 · 无云服务"
    }
    var body: some View {
        Text(model.statusText)
        if let error = model.error { Text(error) }
        if let url = model.nameURL { Text(url.absoluteString) }
        if let url = model.ipURL, url != model.nameURL { Text(url.absoluteString) }
        Divider()
        Button(model.running ? "停止服务" : "开启服务") { model.running ? model.stop() : model.start() }
            .disabled(model.changing || (!model.running && !model.canStart))
        if !model.controllers.isEmpty { Button(model.controllers.count == 1 ? "断开当前控制者" : "断开全部控制者") { model.disconnect() } }
        if !model.permitted { Button("授予辅助功能权限…") { model.authorize() } }
        Divider()
        if model.addresses.isEmpty {
            Text("未找到可用的家庭网络地址，请检查 Wi-Fi 或网线连接")
        } else if model.addresses.count > 1 {
            Picker("网络地址", selection: $model.selectedAddress) {
                ForEach(model.addresses) { Text($0.ip).tag($0.ip) }
            }.disabled(model.running || model.changing)
        }
        Toggle("登录时启动", isOn: Binding(get: { model.loginStatus == .enabled || model.loginStatus == .requiresApproval }, set: model.setLogin))
        if model.loginStatus != .enabled { Text(model.loginLabel) }
        Divider()
        Text(Self.versionLabel)
        Button("退出 SofaPad") { model.quit() }.keyboardShortcut("q")
    }
}
