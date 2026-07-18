import UIKit
import Capacitor

/* Registers app-local Capacitor plugins (not distributed as packages). */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FreeDiskPlugin())
        bridge?.registerPluginInstance(NativeSTTPlugin())
        bridge?.registerPluginInstance(NativeAudioImportPlugin())
        bridge?.registerPluginInstance(RecordingSessionPlugin())

        // Test automation hook: launching with MG_SELFTEST=1 (devicectl
        // --environment-variables) starts the in-app reliability self-test
        // without any UI interaction. MG_SELFTEST_SECS (per-cycle recording
        // seconds) and MG_SELFTEST_CYCLES tune the run; MG_SELFTEST_LADDER
        // (comma-separated seconds) runs one cycle per duration instead.
        let env = ProcessInfo.processInfo.environment
        if env["MG_SELFTEST"] == "1" {
            let secs = Int(env["MG_SELFTEST_SECS"] ?? "") ?? 20
            let cycles = Int(env["MG_SELFTEST_CYCLES"] ?? "") ?? 25
            let ladder = (env["MG_SELFTEST_LADDER"] ?? "")
                .split(separator: ",").compactMap { Int($0) }
            let detail = "{secs:\(secs),cycles:\(cycles),ladder:[\(ladder.map(String.init).joined(separator: ","))]}"
            for delay in [4.0, 8.0, 14.0] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                    self?.bridge?.webView?.evaluateJavaScript(
                        "window.dispatchEvent(new CustomEvent('mg-selftest-autostart', {detail:\(detail)}))",
                        completionHandler: nil
                    )
                }
            }
        }
    }
}
