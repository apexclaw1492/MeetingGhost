import Foundation
import Capacitor
import Speech
import AVFoundation

/* Native on-device transcription — replaces Whisper-WASM on iOS, where ML
   inference inside WKWebView trips the process memory ceiling and kills the
   app. Runs in native memory instead.

   iOS 26+: SpeechAnalyzer/SpeechTranscriber with the offline preset
   (Apple's on-device model, system-managed assets — audio never leaves
   the device). Older iOS: SFSpeechRecognizer with on-device recognition. */
@objc(NativeSTTPlugin)
public class NativeSTTPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeSTTPlugin"
    public let jsName = "NativeSTT"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "transcribeFile", returnType: CAPPluginReturnPromise)
    ]

    @objc func available(_ call: CAPPluginCall) {
        if #available(iOS 26.0, *) {
            call.resolve(["available": true, "engine": "SpeechAnalyzer"])
            return
        }
        if let rec = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), rec.supportsOnDeviceRecognition {
            call.resolve(["available": true, "engine": "SFSpeechRecognizer"])
        } else {
            call.resolve(["available": false])
        }
    }

    @objc func transcribeFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("path is required")
            return
        }
        let srcURL = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: srcURL.path) else {
            call.reject("Audio file not found: \(srcURL.lastPathComponent)")
            return
        }
        // Segments are stored without an extension; AVFoundation needs a typed
        // container, so stage a temporary .m4a copy (MediaRecorder emits AAC/MP4).
        let tmpURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("m4a")
        do {
            try FileManager.default.copyItem(at: srcURL, to: tmpURL)
        } catch {
            call.reject("Could not stage audio for transcription: \(error.localizedDescription)")
            return
        }
        let cleanup: () -> Void = { _ = try? FileManager.default.removeItem(at: tmpURL) }

        if #available(iOS 26.0, *) {
            Task {
                do {
                    let text = try await Self.transcribeWithAnalyzer(url: tmpURL)
                    cleanup()
                    call.resolve(["text": text, "engine": "SpeechAnalyzer"])
                } catch {
                    cleanup()
                    call.reject("On-device transcription failed: \(error.localizedDescription)")
                }
            }
        } else {
            legacyTranscribe(url: tmpURL, cleanup: cleanup, call: call)
        }
    }

    @available(iOS 26.0, *)
    static func transcribeWithAnalyzer(url: URL) async throws -> String {
        let locale = Locale(identifier: "en-US")
        // SpeechTranscriber IS the on-device model — final results only
        let transcriber = SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [],
            attributeOptions: []
        )

        // Ensure the system's on-device model for this locale is installed
        let installed = await Set(SpeechTranscriber.installedLocales).map { $0.identifier(.bcp47) }
        if !installed.contains(locale.identifier(.bcp47)) {
            if let downloader = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                try await downloader.downloadAndInstall()
            }
        }

        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let audioFile = try AVAudioFile(forReading: url)

        // Collect concurrently so long files can't deadlock the results buffer
        async let textFuture: String = transcriber.results.reduce(into: "") { acc, result in
            if result.isFinal { acc += String(result.text.characters) }
        }

        if let lastSampleTime = try await analyzer.analyzeSequence(from: audioFile) {
            try await analyzer.finalizeAndFinish(through: lastSampleTime)
        } else {
            await analyzer.cancelAndFinishNow()
        }
        return try await textFuture
    }

    private func legacyTranscribe(url: URL, cleanup: @escaping () -> Void, call: CAPPluginCall) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
              recognizer.supportsOnDeviceRecognition else {
            cleanup()
            call.reject("On-device speech recognition is not available on this device.")
            return
        }
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                cleanup()
                call.reject("Speech recognition permission denied. Enable it in Settings → MeetingGhost.")
                return
            }
            let request = SFSpeechURLRecognitionRequest(url: url)
            request.requiresOnDeviceRecognition = true // audio never leaves the device
            if #available(iOS 16.0, *) { request.addsPunctuation = true }
            recognizer.recognitionTask(with: request) { result, error in
                if let error = error {
                    cleanup()
                    call.reject("Transcription failed: \(error.localizedDescription)")
                    return
                }
                if let result = result, result.isFinal {
                    cleanup()
                    call.resolve(["text": result.bestTranscription.formattedString, "engine": "SFSpeechRecognizer"])
                }
            }
        }
    }
}
