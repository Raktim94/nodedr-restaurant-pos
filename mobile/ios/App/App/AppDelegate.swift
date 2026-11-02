import UIKit
import Capacitor
import Network

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

// MARK: - Choosing the restaurant server

/// OrderRestro is self-hosted, so the phone remembers which restaurant server it
/// talks to. The address is typed or scanned once (on the bundled connect
/// screen); after that the app opens that server's own web app, with the native
/// bridge (push, location, haptics) available inside its pages.
enum ServerStore {
    static let activeKey = "orderrestro.serverUrl" // the address in use (also the pre-1.16 single address)
    static let localKey = "orderrestro.localUrl"
    static let externalKey = "orderrestro.externalUrl"
    static let lastLocalKey = "orderrestro.lastLocalUrl"
    static let lastExternalKey = "orderrestro.lastExternalUrl"
    static let modeKey = "orderrestro.mode" // "app" or "standalone"
    static var mode: String { d.string(forKey: modeKey) ?? "app" }
    private static var d: UserDefaults { UserDefaults.standard }

    /// True for addresses that only work on the restaurant network.
    static func isLocalAddress(_ url: String) -> Bool {
        guard let h = URL(string: url)?.host?.lowercased() else { return false }
        let range = NSRange(location: 0, length: h.utf16.count)
        let priv = try? NSRegularExpression(pattern: "^(10|127)\\.|^192\\.168\\.|^172\\.(1[6-9]|2\\d|3[01])\\.|^169\\.254\\.")
        return priv?.firstMatch(in: h, range: range) != nil || h.hasSuffix(".local") || h.hasSuffix(".lan") || !h.contains(".")
    }

    static var local: String {
        let v = d.string(forKey: localKey) ?? ""
        let old = d.string(forKey: activeKey) ?? ""
        if v.isEmpty && (d.string(forKey: externalKey) ?? "").isEmpty && isLocalAddress(old) { return old }
        return v
    }
    static var external: String {
        let v = d.string(forKey: externalKey) ?? ""
        let old = d.string(forKey: activeKey) ?? ""
        if v.isEmpty && (d.string(forKey: localKey) ?? "").isEmpty && !old.isEmpty && !isLocalAddress(old) { return old }
        return v
    }
    /// The address chosen last time (no network access). Empty when not connected.
    static var saved: String {
        let a = d.string(forKey: activeKey) ?? ""
        if !a.isEmpty { return a }
        return local.isEmpty ? external : local
    }

    static func save(local l: String, external e: String) {
        d.set(l, forKey: localKey)
        d.set(e, forKey: externalKey)
        d.set(l.isEmpty ? e : l, forKey: activeKey)
    }

    static func forget() {
        d.set(local, forKey: lastLocalKey)
        d.set(external, forKey: lastExternalKey)
        d.removeObject(forKey: localKey)
        d.removeObject(forKey: externalKey)
        d.removeObject(forKey: activeKey)
    }

    /// Does an OrderRestro server answer at this address within a moment?
    static func reachable(_ base: String) -> Bool {
        guard let url = URL(string: base + "/api/v1/auth/setup-status") else { return false }
        var req = URLRequest(url: url)
        req.timeoutInterval = 1.5
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            ok = (resp as? HTTPURLResponse)?.statusCode == 200
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 2.5)
        return ok
    }

    /// Local address if it answers, otherwise the online one. Blocks for at most about 2.5 seconds.
    static func resolve() -> String {
        let l = local, e = external
        let pick: String
        if l.isEmpty || e.isEmpty { pick = l.isEmpty ? e : l }
        else { pick = reachable(l) ? l : e }
        if !pick.isEmpty { d.set(pick, forKey: activeKey) }
        return pick
    }

    /// Start over with a fresh web view so the new server takes effect.
    static func relaunchUI() {
        DispatchQueue.main.async {
            guard let window = (UIApplication.shared.delegate as? AppDelegate)?.window else { return }
            window.rootViewController = MainViewController()
            window.makeKeyAndVisible()
        }
    }

    private static var monitor: NWPathMonitor?
    /// With both addresses saved, move to the better one when the phone changes network.
    static func watchNetwork() {
        monitor?.cancel()
        monitor = nil
        guard !local.isEmpty, !external.isEmpty else { return }
        let m = NWPathMonitor()
        var first = true
        m.pathUpdateHandler = { path in
            if first { first = false; return }
            guard path.status == .satisfied else { return }
            let now = saved
            let next = resolve()
            if !next.isEmpty && next != now { relaunchUI() }
        }
        m.start(queue: DispatchQueue(label: "orderrestro.network"))
        monitor = m
    }
}

@objc(ServerLinkPlugin)
public class ServerLinkPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ServerLinkPlugin"
    public let jsName = "ServerLink"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "current", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushReady", returnType: CAPPluginReturnPromise),
    ]

    @objc func current(_ call: CAPPluginCall) {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        let active = ServerStore.saved
        let l = ServerStore.local, e = ServerStore.external
        let d = UserDefaults.standard
        call.resolve([
            "url": active,
            "localUrl": l.isEmpty && active.isEmpty ? (d.string(forKey: ServerStore.lastLocalKey) ?? "") : l,
            "externalUrl": e.isEmpty && active.isEmpty ? (d.string(forKey: ServerStore.lastExternalKey) ?? "") : e,
            "mode": active.isEmpty ? "" : (active == l ? "local" : "online"),
            "version": version,
            "startMode": ServerStore.mode,
        ])
    }

    @objc func connect(_ call: CAPPluginCall) {
        var l = call.getString("localUrl") ?? ""
        var e = call.getString("externalUrl") ?? ""
        let one = call.getString("url") ?? ""
        if l.isEmpty && e.isEmpty && !one.isEmpty {
            if ServerStore.isLocalAddress(one) { l = one } else { e = one }
        }
        func valid(_ u: String) -> Bool { u.isEmpty || u.hasPrefix("http://") || u.hasPrefix("https://") }
        guard !(l.isEmpty && e.isEmpty), valid(l), valid(e) else {
            call.reject("Enter a full address such as http://192.168.1.20:1995")
            return
        }
        ServerStore.save(local: l, external: e)
        call.resolve()
        ServerStore.relaunchUI()
    }

    @objc func setMode(_ call: CAPPluginCall) {
        let m = call.getString("mode") ?? "app"
        guard m == "app" || m == "standalone" else { call.reject("Unknown mode"); return }
        UserDefaults.standard.set(m, forKey: ServerStore.modeKey)
        call.resolve()
        ServerStore.relaunchUI()
    }

    @objc func forget(_ call: CAPPluginCall) {
        ServerStore.forget()
        call.resolve()
        ServerStore.relaunchUI()
    }

    /// On iOS push goes straight through APNs, so there is nothing else to configure in the app.
    @objc func pushReady(_ call: CAPPluginCall) {
        call.resolve(["ready": true])
    }
}


// MARK: - Printing from the phone

/// AirPrint (any printer on the network, or "Save to Files" as PDF) for bills and
/// kitchen tickets. iPhones cannot talk to Bluetooth thermal printers directly
/// (no Bluetooth Classic access), so btPrinters reports "not supported" and the
/// web app uses the print dialog instead.
@objc(NativePrinterPlugin)
public class NativePrinterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativePrinterPlugin"
    public let jsName = "NativePrinter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "btPrinters", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "btPrint", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printHtml", returnType: CAPPluginReturnPromise),
    ]

    @objc func btPrinters(_ call: CAPPluginCall) {
        call.resolve(["supported": false, "enabled": false, "devices": []])
    }

    @objc func btPrint(_ call: CAPPluginCall) {
        call.reject("Bluetooth thermal printers are not available on iPhone. Use Print / Save PDF (AirPrint).")
    }

    @objc func printHtml(_ call: CAPPluginCall) {
        guard let html = call.getString("html"), !html.isEmpty else {
            call.reject("Nothing to print.")
            return
        }
        let name = call.getString("name") ?? "OrderRestro"
        DispatchQueue.main.async {
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = name
            let controller = UIPrintInteractionController.shared
            controller.printInfo = info
            controller.printFormatter = UIMarkupTextPrintFormatter(markupText: html)
            controller.present(animated: true) { _, _, _ in }
            call.resolve()
        }
    }
}

class MainViewController: CAPBridgeViewController {
    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        let server = ServerStore.mode == "standalone" ? "" : ServerStore.resolve()
        if !server.isEmpty {
            descriptor.serverURL = server
            descriptor.allowedNavigationHostnames = ["*"]
        }
        return descriptor
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ServerLinkPlugin())
        bridge?.registerPluginInstance(NativePrinterPlugin())
        ServerStore.watchNetwork()
    }
}
