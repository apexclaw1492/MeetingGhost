import Foundation
import Capacitor

/* Reports the device's REAL available disk capacity (the value iOS would
   allow an app to use for important data), which WKWebView cannot see.
   Used by the recorder to warn/auto-stop before storage exhausts. */
@objc(FreeDiskPlugin)
public class FreeDiskPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FreeDiskPlugin"
    public let jsName = "FreeDisk"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "free", returnType: CAPPluginReturnPromise)
    ]

    @objc func free(_ call: CAPPluginCall) {
        let url = URL(fileURLWithPath: NSHomeDirectory())
        do {
            let values = try url.resourceValues(forKeys: [
                .volumeAvailableCapacityForImportantUsageKey,
                .volumeTotalCapacityKey
            ])
            call.resolve([
                "free": values.volumeAvailableCapacityForImportantUsage ?? -1,
                "total": values.volumeTotalCapacity ?? -1
            ])
        } catch {
            call.reject("Free-disk query failed: \(error.localizedDescription)")
        }
    }
}
