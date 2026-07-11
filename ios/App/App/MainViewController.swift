import UIKit
import Capacitor

/* Registers app-local Capacitor plugins (not distributed as packages). */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FreeDiskPlugin())
    }
}
