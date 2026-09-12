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
    @Published var controllers: [String] = []
    @Published var permitted = AXIsProcessTrusted()
    @Published var error: String?
    @Published var loginStatus = SMAppService.mainApp.status
    let port = 9876
    let control: ControlState
    let server: LocalServer
    private let queue = DispatchQueue(label: "SofaPad.ServerLifecycle")
    private var timer: Timer?
    private var observers: [NSObjectProtocol] = []
    private var activeAddress = ""
    private var activeHostname: String?
    private var suspensionReasons = Set<String>()
    /// A user pressing "停止服务" keeps it off; a network change does not.
    private var stoppedByUser = false
    private var restartPending = false
    /// Menu wording for the three ways the service can be off.
    var statusText: String {
        if running {
            if controllers.isEmpty { return "等待手机连接" }
            if controllers.count == 1 { return "\(controllers[0]) 正在控制" }
            return "\(controllers.count) 台设备正在控制"
        }
        if stoppedByUser { return "服务已关闭" }
        return addresses.isEmpty ? "正在等待网络…" : "正在开启服务…"
    }
    /// The Bonjour name: a fixed address even when the router changes the IP.
    var nameURL: URL? {
        guard running, let host = activeHostname else { return nil }
        return URL(string: "http://\(host):\(port)/")
    }
    /// The direct IP: works without mDNS, but can change with the DHCP lease.
    var ipURL: URL? {
        guard running else { return nil }
        return URL(string: "http://\(activeAddress):\(port)/")
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
        let state = ControlState(executor: MouseEventExecutor(), name: Host.current().localizedName ?? "Mac")
        control = state; server = LocalServer(state: state)
        // Keep the remembered address even when the interface is not up yet: at login the
        // network usually arrives a few seconds after the app does.
        selectedAddress = UserDefaults.standard.string(forKey: "interfaceAddress") ?? ""
        if selectedAddress.isEmpty { selectedAddress = addresses.first?.ip ?? "" }
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
            control.disconnect(reason: "host_stopped")
        })
        requestAccessibilityIfNeeded()
        // The service is the whole point of the app: it is on whenever SofaPad is.
        start()
    }
    /// Ask macOS for the accessibility grant at launch. The system owns this alert
    /// and the switch in System Settings; the app can never grant itself.
    private func requestAccessibilityIfNeeded() {
        guard !AXIsProcessTrusted() else { return }
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }
    private func updateSuspension() { control.setSuspended(!suspensionReasons.isEmpty) }
    func refresh() {
        let fresh = NetworkAddress.available()
        let appeared = fresh != addresses && !fresh.isEmpty
        if fresh != addresses {
            addresses = fresh
            if !fresh.contains(where: { $0.ip == selectedAddress }) { selectedAddress = fresh.first?.ip ?? "" }
        }
        if running && (!fresh.contains(where: { $0.ip == activeAddress }) || NetworkAddress.hostname != activeHostname) {
            // Address or hostname moved: stop now and come back on the next tick.
            stopService(); restartPending = true
        }
        let snapshot = control.snapshot()
        controllers = snapshot.controllers; permitted = snapshot.permitted
        loginStatus = SMAppService.mainApp.status
        if ServiceLaunchPolicy.shouldStart(running: running, changing: changing, stoppedByUser: stoppedByUser,
                                           hasAddress: fresh.contains(where: { $0.ip == selectedAddress }),
                                           addressAppeared: appeared, restartPending: restartPending) {
            restartPending = false
            start()
        }
    }
    var canStart: Bool { !selectedAddress.isEmpty }
    func start() {
        guard !running, !changing, canStart,
              addresses.contains(where: { $0.ip == selectedAddress }) else { return }
        stoppedByUser = false
        let webRoot = Bundle.main.resourceURL!.appendingPathComponent("Web")
        let address = selectedAddress, hostname = NetworkAddress.hostname
        changing = true; error = nil
        UserDefaults.standard.set(address, forKey: "interfaceAddress")
        queue.async { [weak self] in
            do {
                try self?.server.start(address: address, port: self?.port ?? 9876, hostname: hostname, webRoot: webRoot)
                DispatchQueue.main.async {
                    self?.changing = false; self?.running = true
                    self?.activeAddress = address; self?.activeHostname = hostname
                }
            } catch {
                DispatchQueue.main.async {
                    self?.changing = false
                    self?.error = "无法开启服务。请确认 Mac 已连接家庭网络，然后重试；若仍失败，重新打开 SofaPad。"
                }
            }
        }
    }
    /// Menu action: the service stays off until the user starts it again.
    func stop() { stoppedByUser = true; restartPending = false; stopService() }
    private func stopService() {
        guard !changing else { return }
        changing = true; running = false
        queue.async { [weak self] in
            self?.server.stop()
            DispatchQueue.main.async { self?.changing = false; self?.refresh() }
        }
    }
    func disconnect() { control.disconnect(); refresh() }
    func quit() { control.disconnect(reason: "host_stopped"); NSApp.terminate(nil) }
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
