import UIKit
import Capacitor

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
    static let key = "orderrestro.serverUrl"
    static var url: String? {
        get { UserDefaults.standard.string(forKey: key) }
        set {
            if let v = newValue { UserDefaults.standard.set(v, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
    }
    /// Start over with a fresh web view so the new server takes effect.
    static func relaunchUI() {
        DispatchQueue.main.async {
            guard let window = (UIApplication.shared.delegate as? AppDelegate)?.window else { return }
            window.rootViewController = MainViewController()
            window.makeKeyAndVisible()
        }
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
        CAPPluginMethod(name: "pushReady", returnType: CAPPluginReturnPromise),
    ]

    @objc func current(_ call: CAPPluginCall) {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        call.resolve(["url": ServerStore.url ?? "", "version": version])
    }

    @objc func connect(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), url.hasPrefix("http://") || url.hasPrefix("https://") else {
            call.reject("Enter a full address such as http://192.168.1.20:1995")
            return
        }
        ServerStore.url = url
        call.resolve()
        ServerStore.relaunchUI()
    }

    @objc func forget(_ call: CAPPluginCall) {
        ServerStore.url = nil
        call.resolve()
        ServerStore.relaunchUI()
    }

    /// On iOS push goes straight through APNs, so there is nothing else to configure in the app.
    @objc func pushReady(_ call: CAPPluginCall) {
        call.resolve(["ready": true])
    }
}

class MainViewController: CAPBridgeViewController {
    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        if let server = ServerStore.url, !server.isEmpty {
            descriptor.serverURL = server
            descriptor.allowedNavigationHostnames = ["*"]
        }
        return descriptor
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ServerLinkPlugin())
    }
}
