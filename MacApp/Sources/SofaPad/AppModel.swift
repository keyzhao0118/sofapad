import SwiftUI
import AppKit
import ApplicationServices
import ServiceManagement
import SofaPadCore

@MainActor final class AppModel: ObservableObject {
    @Published var addresses = NetworkAddress.available()
    @Published var selectedAddress = ""
    @Published var running = false
    @Published var changing = false
    @Published var acceptedHTTP = false
    @Published var hasCertificate = false
    @Published var secure = true
    private var tlsDirectory: URL?
    private var tls: ServerTLS? {
        guard hasCertificate, let directory = tlsDirectory else { return nil }
        return ServerTLS(certificatePath: directory.appendingPathComponent("certificate.pem").path,
                         privateKeyPath: directory.appendingPathComponent("private-key.pem").path)
    }
    var canStart: Bool { !selectedAddress.isEmpty && (acceptedHTTP || hasCertificate) }
    @Published var pairURL: URL?
    @Published var pairExpiry: Date?
    @Published var devices: [PairedDevice] = []
    @Published var activeName: String?
    @Published var permitted = AXIsProcessTrusted()
    @Published var error: String?
    @Published var loginStatus = SMAppService.mainApp.status
    @Published var useHostname = false
    let port = 9876
    private var control: ControlState?
    private var server: LocalServer?
    private let queue = DispatchQueue(label: "SofaPad.ServerLifecycle")
    private var timer: Timer?
    private var observers: [NSObjectProtocol] = []
    private var activeAddress = ""
    private var activeHostname: String?
    private var suspensionReasons = Set<String>()
    var hostname: String? { running ? activeHostname : NetworkAddress.hostname }
    var accessURL: URL? {
        guard running else { return nil }
        let host = useHostname ? (activeHostname ?? activeAddress) : activeAddress
        return URL(string: "\(secure ? "https" : "http")://\(host):\(port)/")
    }
    var loginLabel: String {
        switch loginStatus {
        case .enabled: return "已启用"
        case .requiresApproval: return "等待系统批准"
        case .notRegistered: return "未启用"
        case .notFound: return "需要安装到应用程序目录"
        @unknown default: return "未知状态"
        }
    }
    init() {
        selectedAddress = UserDefaults.standard.string(forKey: "interfaceAddress") ?? addresses.first?.ip ?? ""
        if !addresses.contains(where: { $0.ip == selectedAddress }) { selectedAddress = addresses.first?.ip ?? "" }
        do {
            let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            tlsDirectory = root.appendingPathComponent("SofaPad/TLS")
            hasCertificate = FileManager.default.fileExists(atPath: tlsDirectory!.appendingPathComponent("certificate.pem").path)
                && FileManager.default.fileExists(atPath: tlsDirectory!.appendingPathComponent("private-key.pem").path)
            let store = try CredentialStore(file: root.appendingPathComponent("SofaPad/devices.json"))
            let state = ControlState(store: store, executor: MouseEventExecutor(), name: Host.current().localizedName ?? "Mac")
            control = state; server = LocalServer(state: state)
        } catch { self.error = "无法读取配对记录。请检查 ~/Library/Application Support/SofaPad 的访问权限。" }
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        let workspace = NSWorkspace.shared.notificationCenter
        for (off, on, reason) in [
            (NSWorkspace.willSleepNotification, NSWorkspace.didWakeNotification, "sleep"),
            (NSWorkspace.screensDidSleepNotification, NSWorkspace.screensDidWakeNotification, "display"),
            (NSWorkspace.sessionDidResignActiveNotification, NSWorkspace.sessionDidBecomeActiveNotification, "session")
        ] {
            observers.append(workspace.addObserver(forName: off, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.suspensionReasons.insert(reason); self?.updateSuspension() }
            })
            observers.append(workspace.addObserver(forName: on, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.suspensionReasons.remove(reason); self?.updateSuspension(); self?.refresh() }
            })
        }
        refresh()
        // Synchronous cleanup also covers the standard application Quit command.
        let control = control
        observers.append(NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: nil) { _ in
            control?.disconnect(reason: "host_stopped")
        })
        if hasCertificate && UserDefaults.standard.bool(forKey: "secureServiceEnabled") { start() }
    }
    private func updateSuspension() { control?.setSuspended(!suspensionReasons.isEmpty) }
    func refresh() {
        let fresh = NetworkAddress.available()
        if fresh != addresses { addresses = fresh }
        if running && (!fresh.contains(where: { $0.ip == activeAddress }) || activeHostname != NetworkAddress.hostname) {
            stop(); error = "网络地址发生变化，服务已停止。请选择当前地址并重新启用；切换地址后手机可能需要重新配对。"
        }
        if let snapshot = control?.snapshot() {
            devices = snapshot.devices; activeName = snapshot.activeName; permitted = snapshot.permitted
            pairExpiry = snapshot.pairingExpiry
            if snapshot.pairingExpiry == nil { pairURL = nil }
        }
        if let expiry = pairExpiry, expiry <= Date() { closePairing() }
        loginStatus = SMAppService.mainApp.status
    }
    func start() {
        guard !running, !changing, canStart, let server,
              addresses.contains(where: { $0.ip == selectedAddress }) else { return }
        let webRoot = Bundle.main.resourceURL!.appendingPathComponent("Web")
        let address = selectedAddress, hostname = NetworkAddress.hostname, port = port
        let tls = acceptedHTTP ? nil : self.tls
        changing = true; error = nil
        UserDefaults.standard.set(address, forKey: "interfaceAddress")
        queue.async { [weak self] in
            do {
                try server.start(address: address, port: port, hostname: hostname, webRoot: webRoot, tls: tls)
                DispatchQueue.main.async {
                    self?.changing = false; self?.running = true; self?.activeAddress = address; self?.activeHostname = hostname
                    self?.secure = tls != nil
                    UserDefaults.standard.set(tls != nil, forKey: "secureServiceEnabled")
                }
            } catch {
                DispatchQueue.main.async {
                    self?.changing = false
                    self?.error = "无法启动服务（\(error.localizedDescription)）。检查端口 \(port) 是否被占用、局域网权限和网页资源是否完整。"
                }
            }
        }
    }
    func stop() {
        guard !changing, let server else { return }
        changing = true; pairURL = nil; pairExpiry = nil; running = false
        UserDefaults.standard.set(false, forKey: "secureServiceEnabled")
        queue.async { [weak self] in
            server.stop()
            DispatchQueue.main.async { self?.changing = false; self?.refresh() }
        }
    }
    func beginPairing() {
        guard running, let control, let base = accessURL else { return }
        do {
            let token = try control.beginPairing()
            var components = URLComponents(url: base, resolvingAgainstBaseURL: false)!
            components.fragment = "pair=\(token)"; pairURL = components.url; refresh()
        } catch { self.error = "无法创建配对令牌，请重试。" }
    }
    func closePairing() { control?.closePairing(); pairURL = nil; pairExpiry = nil }
    func changeURLMode() { closePairing() }
    func disconnect() { control?.disconnect(); refresh() }
    func quit() { control?.disconnect(reason: "host_stopped"); NSApp.terminate(nil) }
    func importTLS() {
        guard !running, !changing, let destination = tlsDirectory else { return }
        func select(_ message: String) -> URL? {
            let panel = NSOpenPanel(); panel.message = message; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
            return panel.runModal() == .OK ? panel.url : nil
        }
        guard let certificate = select("选择 PEM 格式的 HTTPS 证书链"),
              let key = select("选择对应的未加密 PEM 私钥（仅保存到本机）") else { return }
        do {
            try ServerTLS(certificatePath: certificate.path, privateKeyPath: key.path).validate()
            let certificateData = try Data(contentsOf: certificate), keyData = try Data(contentsOf: key)
            try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            for (name, data) in [("certificate.pem", certificateData), ("private-key.pem", keyData)] {
                let url = destination.appendingPathComponent(name)
                try data.write(to: url, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            }
            hasCertificate = true; acceptedHTTP = false; error = nil
        } catch { self.error = "证书或私钥无效，尚未开启 HTTPS。请检查 PEM 格式与对应关系。" }
    }
    func revoke(_ device: PairedDevice) {
        do { try control?.revoke(id: device.id); refresh() }
        catch { self.error = "移除失败，配对记录无法保存。请检查文件权限后重试。" }
    }
    func authorize() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        openSettings("Privacy_Accessibility")
    }
    func openSettings(_ pane: String) {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") { NSWorkspace.shared.open(url) }
    }
    func setLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginStatus = SMAppService.mainApp.status
            if loginStatus == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
        } catch { self.error = "登录启动设置失败：\(error.localizedDescription)"; refresh() }
    }
}
