import UIKit
import Capacitor

/* Registers app-local Capacitor plugins (not distributed as packages). */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FreeDiskPlugin())
        bridge?.registerPluginInstance(NativeSTTPlugin())

        // Test automation hook: launching with MG_SELFTEST=1 (devicectl
        // --environment-variables) starts the in-app reliability self-test
        // without any UI interaction. No effect on normal launches.
        if ProcessInfo.processInfo.environment["MG_SELFTEST"] == "1" {
            for delay in [4.0, 8.0, 14.0] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                    self?.bridge?.webView?.evaluateJavaScript(
                        "window.dispatchEvent(new CustomEvent('mg-selftest-autostart'))",
                        completionHandler: nil
                    )
                }
            }
        }
    }
}
