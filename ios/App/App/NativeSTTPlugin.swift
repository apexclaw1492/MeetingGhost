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
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "transcribeFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private var activeOperationId: UUID?
    private var activeCall: CAPPluginCall?
    private var activeAnalyzerTask: Task<Void, Never>?
    private var activeLegacyTask: SFSpeechRecognitionTask?
    private var activeCleanup: (() -> Void)?

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

    @objc func info(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let sourceURL = Self.validatedAudioURL(path) else {
            call.reject("A valid app-private recording path is required.")
            return
        }
        do {
            let audioFile = try AVAudioFile(forReading: sourceURL)
            let sampleRate = audioFile.processingFormat.sampleRate
            guard sampleRate > 0, audioFile.length > 0 else {
                throw NativeSTTError.message("The audio file has no decodable duration.")
            }
            let durationMs = Int64((Double(audioFile.length) / sampleRate * 1000).rounded(.up))
            let bytes = Int64(try sourceURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
            call.resolve([
                "durationMs": durationMs,
                "bytes": bytes,
                "engine": "AVAudioFile"
            ])
        } catch {
            call.reject("Could not inspect saved audio: \(error.localizedDescription)")
        }
    }

    @objc func transcribeFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let srcURL = Self.validatedAudioURL(path) else {
            call.reject("A valid app-private recording path is required.")
            return
        }
        let requestedStartMs = max(0, call.getInt("startMs") ?? 0)
        let requestedDurationMs = min(60_000, max(0, call.getInt("durationMs") ?? 0))
        let preparedURL: URL
        do {
            preparedURL = requestedDurationMs > 0
                ? try Self.writeBoundedChunk(
                    sourceURL: srcURL,
                    startMs: requestedStartMs,
                    durationMs: requestedDurationMs
                )
                : try Self.stageTypedReference(sourceURL: srcURL)
        } catch {
            call.reject("Could not prepare the bounded audio chunk: \(error.localizedDescription)")
            return
        }
        let cleanup: () -> Void = { _ = try? FileManager.default.removeItem(at: preparedURL) }
        cancelActive(reason: "A newer transcription request replaced the previous native operation.")
        let operationId = UUID()
        activeOperationId = operationId
        activeCall = call
        activeCleanup = cleanup

        if #available(iOS 26.0, *) {
            activeAnalyzerTask = Task { [weak self] in
                do {
                    let text = try await Self.transcribeWithAnalyzer(url: preparedURL)
                    cleanup()
                    guard let self, self.activeOperationId == operationId else { return }
                    self.clearActive(operationId: operationId)
                    call.resolve([
                        "text": text,
                        "engine": "SpeechAnalyzer",
                        "startMs": requestedStartMs,
                        "durationMs": requestedDurationMs
                    ])
                } catch {
                    cleanup()
                    guard let self, self.activeOperationId == operationId else { return }
                    self.clearActive(operationId: operationId)
                    call.reject("On-device transcription failed: \(error.localizedDescription)")
                }
            }
        } else {
            legacyTranscribe(url: preparedURL, cleanup: cleanup, call: call, operationId: operationId)
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        let canceled = activeOperationId != nil
        cancelActive(reason: "Native transcription canceled; the saved audio and completed checkpoints are unchanged.")
        call.resolve(["canceled": canceled])
    }

    private func cancelActive(reason: String) {
        guard activeOperationId != nil else { return }
        let interruptedCall = activeCall
        let cleanup = activeCleanup
        activeOperationId = nil
        activeCall = nil
        activeCleanup = nil
        activeAnalyzerTask?.cancel()
        activeAnalyzerTask = nil
        activeLegacyTask?.cancel()
        activeLegacyTask = nil
        cleanup?()
        interruptedCall?.reject(reason, "TRANSCRIPTION_CANCELED")
    }

    private func clearActive(operationId: UUID) {
        guard activeOperationId == operationId else { return }
        activeOperationId = nil
        activeCall = nil
        activeCleanup = nil
        activeAnalyzerTask = nil
        activeLegacyTask = nil
    }

    private static func validatedAudioURL(_ path: String) -> URL? {
        let source = URL(fileURLWithPath: path).standardizedFileURL
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .standardizedFileURL
        let recordingsRoot = documents.appendingPathComponent("recordings", isDirectory: true).path + "/"
        guard source.path.hasPrefix(recordingsRoot),
              FileManager.default.fileExists(atPath: source.path) else { return nil }
        return source
    }

    /**
     AVAudioFile reads only one minute of decoded PCM at a time and writes it to
     a temporary CAF in small buffers. Apple Speech therefore never receives an
     hours-long all-or-nothing input, and JavaScript can checkpoint every unit.
     */
    private static func writeBoundedChunk(sourceURL: URL, startMs: Int, durationMs: Int) throws -> URL {
        let input = try AVAudioFile(forReading: sourceURL)
        let format = input.processingFormat
        guard format.sampleRate > 0, input.length > 0 else {
            throw NativeSTTError.message("The audio file has no decodable samples.")
        }
        let startFrame = min(
            input.length,
            AVAudioFramePosition((Double(startMs) / 1000 * format.sampleRate).rounded(.down))
        )
        let requestedFrames = AVAudioFramePosition(
            (Double(durationMs) / 1000 * format.sampleRate).rounded(.up)
        )
        var remaining = min(max(0, input.length - startFrame), requestedFrames)
        guard remaining > 0 else {
            throw NativeSTTError.message("The requested audio chunk is outside the saved recording.")
        }

        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("caf")
        do {
            let output = try AVAudioFile(forWriting: outputURL, settings: format.settings)
            input.framePosition = startFrame
            let capacity = AVAudioFrameCount(min(8_192, remaining))
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
                throw NativeSTTError.message("Could not allocate the bounded audio buffer.")
            }
            var written: AVAudioFramePosition = 0
            while remaining > 0 {
                let requested = AVAudioFrameCount(min(AVAudioFramePosition(capacity), remaining))
                try input.read(into: buffer, frameCount: requested)
                guard buffer.frameLength > 0 else { break }
                try output.write(from: buffer)
                written += AVAudioFramePosition(buffer.frameLength)
                remaining -= AVAudioFramePosition(buffer.frameLength)
            }
            guard written > 0 else {
                throw NativeSTTError.message("The requested audio chunk decoded no samples.")
            }
            return outputURL
        } catch {
            try? FileManager.default.removeItem(at: outputURL)
            throw error
        }
    }

    /** Backward-compatible short-file path. Prefer bounded chunks from React. */
    private static func stageTypedReference(sourceURL: URL) throws -> URL {
        let typedURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("m4a")
        do {
            try FileManager.default.linkItem(at: sourceURL, to: typedURL)
        } catch {
            try FileManager.default.copyItem(at: sourceURL, to: typedURL)
        }
        return typedURL
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
            guard result.isFinal else { return }
            let next = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !next.isEmpty else { return }
            if !acc.isEmpty { acc += " " }
            acc += next
        }

        if let lastSampleTime = try await analyzer.analyzeSequence(from: audioFile) {
            try await analyzer.finalizeAndFinish(through: lastSampleTime)
        } else {
            await analyzer.cancelAndFinishNow()
        }
        return try await textFuture
    }

    private func legacyTranscribe(
        url: URL,
        cleanup: @escaping () -> Void,
        call: CAPPluginCall,
        operationId: UUID
    ) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
              recognizer.supportsOnDeviceRecognition else {
            cleanup()
            clearActive(operationId: operationId)
            call.reject("On-device speech recognition is not available on this device.")
            return
        }
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            guard let self, self.activeOperationId == operationId else { return }
            guard status == .authorized else {
                cleanup()
                self.clearActive(operationId: operationId)
                call.reject("Speech recognition permission denied. Enable it in Settings → MeetingGhost.")
                return
            }
            let request = SFSpeechURLRecognitionRequest(url: url)
            request.requiresOnDeviceRecognition = true // audio never leaves the device
            if #available(iOS 16.0, *) { request.addsPunctuation = true }
            self.activeLegacyTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self, self.activeOperationId == operationId else { return }
                if let error = error {
                    cleanup()
                    self.clearActive(operationId: operationId)
                    call.reject("Transcription failed: \(error.localizedDescription)")
                    return
                }
                if let result = result, result.isFinal {
                    cleanup()
                    self.clearActive(operationId: operationId)
                    call.resolve(["text": result.bestTranscription.formattedString, "engine": "SFSpeechRecognizer"])
                }
            }
        }
    }

    private enum NativeSTTError: LocalizedError {
        case message(String)
        var errorDescription: String? {
            guard case let .message(message) = self else { return nil }
            return message
        }
    }
}
