import AVFoundation
import Capacitor
import Foundation
import UIKit

/*
 Native segmented capture. The recorder writes directly into the same
 Directory.Data path consumed by Capacitor Filesystem:

   Documents/recordings/<meetingId>/seg-<n>

 Each segment is recorded as `seg-n.partial` and renamed only after
 AVAudioRecorder closes it and a non-zero size is verified. A process death can
 therefore lose only the current 15-second tail; recovery never sees a corrupt
 segment as complete. React receives progress events but does not own capture.
 */
@objc(RecordingSessionPlugin)
public class RecordingSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RecordingSessionPlugin"
    public let jsName = "RecordingSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "flush", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    private var recorder: AVAudioRecorder?
    private var rotationTimer: DispatchSourceTimer?
    private var meetingId: String?
    private var recordingDirectory: URL?
    private var nextSegment = 0
    private var segmentIds: [Int] = []
    private var failedSegments: [Int] = []
    private var totalBytes: Int64 = 0
    private var recordedMs: Int64 = 0
    private var active = false
    private var stopping = false
    private var segmentSeconds = 15
    private var warnBytes: Int64 = 500 * 1024 * 1024
    private var stopBytes: Int64 = 100 * 1024 * 1024
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        let center = NotificationCenter.default
        observers = [
            center.addObserver(
                forName: AVAudioSession.interruptionNotification,
                object: nil,
                queue: .main
            ) { [weak self] note in self?.handleInterruption(note) },
            center.addObserver(
                forName: AVAudioSession.routeChangeNotification,
                object: nil,
                queue: .main
            ) { [weak self] note in self?.handleRouteChange(note) },
            center.addObserver(
                forName: AVAudioSession.mediaServicesWereResetNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in self?.terminalStop("The iOS audio service restarted; completed segments are safe.") },
            center.addObserver(
                forName: UIApplication.didReceiveMemoryWarningNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in self?.handleMemoryPressure() }
        ]
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        rotationTimer?.cancel()
        recorder?.stop()
    }

    @objc func start(_ call: CAPPluginCall) {
        guard !active else {
            call.reject("A native recording is already active.")
            return
        }
        guard let id = call.getString("meetingId"),
              id.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else {
            call.reject("A safe meetingId is required.")
            return
        }
        let permission = AVAudioSession.sharedInstance().recordPermission
        switch permission {
        case .granted:
            beginRecording(call: call, meetingId: id)
        case .undetermined:
            AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if granted { self.beginRecording(call: call, meetingId: id) }
                    else { call.reject("Microphone permission denied. Enable it in Settings → MeetingGhost.") }
                }
            }
        default:
            call.reject("Microphone permission denied. Enable it in Settings → MeetingGhost.")
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        if active { stopSession() }
        call.resolve(statusPayload())
    }

    @objc func flush(_ call: CAPPluginCall) {
        if active, let recorder, recorder.currentTime >= 0.5 {
            finalizeCurrentSegment(startNext: true)
        }
        call.resolve(statusPayload())
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(statusPayload())
    }

    private func beginRecording(call: CAPPluginCall, meetingId id: String) {
        do {
            segmentSeconds = min(60, max(5, call.getInt("segmentSeconds") ?? 15))
            warnBytes = Int64(call.getDouble("warnBytes") ?? Double(500 * 1024 * 1024))
            stopBytes = Int64(call.getDouble("stopBytes") ?? Double(100 * 1024 * 1024))
            let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let directory = root.appendingPathComponent("recordings", isDirectory: true)
                .appendingPathComponent(id, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try discardPartials(in: directory)

            let existing = try completedSegments(in: directory)
            meetingId = id
            recordingDirectory = directory
            segmentIds = existing
            nextSegment = (existing.max() ?? -1) + 1
            failedSegments = []
            totalBytes = try existing.reduce(Int64(0)) { total, segment in
                let url = directory.appendingPathComponent("seg-\(segment)")
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                return total + Int64(size)
            }
            recordedMs = 0
            stopping = false

            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.allowBluetoothHFP])
            try session.setActive(true)
            active = true
            try startSegment()
            notifyListeners("recordingStarted", data: statusPayload())
            call.resolve(statusPayload())
        } catch {
            active = false
            recorder?.stop()
            recorder = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            call.reject("Could not start native recording: \(error.localizedDescription)")
        }
    }

    private func startSegment() throws {
        guard active, let directory = recordingDirectory else { return }
        // Keep an .m4a extension so AVAudioRecorder selects an AAC/MP4
        // container consistently; the embedded .partial marker keeps it out
        // of recovery manifests until the atomic rename succeeds.
        let partial = directory.appendingPathComponent("seg-\(nextSegment).partial.m4a")
        try? FileManager.default.removeItem(at: partial)
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64_000,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]
        let nextRecorder = try AVAudioRecorder(url: partial, settings: settings)
        nextRecorder.isMeteringEnabled = false
        guard nextRecorder.prepareToRecord(), nextRecorder.record() else {
            throw NSError(domain: "MeetingGhostRecorder", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "The microphone did not begin producing audio."])
        }
        recorder = nextRecorder
        scheduleRotation()
    }

    private func scheduleRotation() {
        rotationTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + .seconds(segmentSeconds))
        timer.setEventHandler { [weak self] in
            guard let self, self.active, !self.stopping else { return }
            self.finalizeCurrentSegment(startNext: true)
        }
        rotationTimer = timer
        timer.resume()
    }

    private func finalizeCurrentSegment(startNext: Bool) {
        rotationTimer?.cancel()
        rotationTimer = nil
        guard let current = recorder, let directory = recordingDirectory else {
            if startNext, active { tryStartNextOrStop() }
            return
        }
        recorder = nil
        let segment = nextSegment
        let durationMs = Int64(max(0, current.currentTime) * 1000)
        let partial = current.url
        current.stop()
        let final = directory.appendingPathComponent("seg-\(segment)")

        do {
            let size = Int64(try partial.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
            guard durationMs >= 250, size > 0 else {
                try? FileManager.default.removeItem(at: partial)
                if startNext, active { tryStartNextOrStop() }
                return
            }
            try? FileManager.default.removeItem(at: final)
            try FileManager.default.moveItem(at: partial, to: final)
            let verified = Int64(try final.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
            guard verified == size else { throw NSError(
                domain: "MeetingGhostRecorder", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Committed segment size did not match its verified recording size."]
            ) }
            segmentIds.append(segment)
            segmentIds.sort()
            totalBytes += verified
            recordedMs += durationMs
            nextSegment = segment + 1
            var event = statusPayload()
            event["seg"] = segment
            event["bytes"] = verified
            event["ms"] = durationMs
            event["freeBytes"] = freeBytes()
            notifyListeners("segmentSaved", data: event)

            let free = freeBytes()
            if free >= 0, free < stopBytes, active, !stopping {
                terminalStop("Storage critically low — recording stopped safely; every completed segment is saved.")
                return
            }
            if free >= 0, free < warnBytes {
                var warning = statusPayload()
                warning["freeBytes"] = free
                notifyListeners("storageWarning", data: warning)
            }
        } catch {
            failedSegments.append(segment)
            try? FileManager.default.removeItem(at: partial)
            var failure = statusPayload()
            failure["seg"] = segment
            failure["error"] = "Segment \(segment + 1) could not be committed: \(error.localizedDescription)"
            notifyListeners("recordingError", data: failure)
            nextSegment = segment + 1
        }

        if startNext, active { tryStartNextOrStop() }
    }

    private func tryStartNextOrStop() {
        do { try startSegment() }
        catch { terminalStop("The native recorder could not continue: \(error.localizedDescription)") }
    }

    private func stopSession() {
        guard !stopping else { return }
        stopping = true
        if recorder != nil { finalizeCurrentSegment(startNext: false) }
        active = false
        rotationTimer?.cancel()
        rotationTimer = nil
        recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        stopping = false
    }

    private func terminalStop(_ reason: String) {
        guard active else { return }
        stopSession()
        var event = statusPayload()
        event["reason"] = reason
        event["error"] = reason
        notifyListeners("autoStopped", data: event)
    }

    private func handleInterruption(_ notification: Notification) {
        guard active,
              let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        var event = statusPayload()
        event["reason"] = "audio-session-interruption"
        notifyListeners("recordingInterrupted", data: event)
        terminalStop("Audio input was interrupted by the system; completed segments are safe.")
    }

    private func handleRouteChange(_ notification: Notification) {
        guard active else { return }
        let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
        let reason = raw.flatMap(AVAudioSession.RouteChangeReason.init(rawValue:))
        var event = statusPayload()
        event["reason"] = "route-change-\(reason?.rawValue ?? 0)"
        notifyListeners("recordingInterrupted", data: event)
        if let recorder, recorder.currentTime >= 0.5 { finalizeCurrentSegment(startNext: true) }
    }

    private func handleMemoryPressure() {
        guard active else { return }
        var event = statusPayload()
        event["reason"] = "ios-memory-warning"
        event["memoryPressureLevel"] = "warning"
        event["freeBytes"] = freeBytes()
        notifyListeners("memoryPressure", data: event)
    }

    private func statusPayload() -> [String: Any] {
        var payload: [String: Any] = [
            "active": active,
            "segmentIds": segmentIds,
            "failedSegments": failedSegments,
            "totalBytes": totalBytes,
            "recordedMs": recordedMs + Int64(max(0, recorder?.currentTime ?? 0) * 1000),
            "mimeType": "audio/mp4"
        ]
        if let meetingId { payload["meetingId"] = meetingId }
        return payload
    }

    private func completedSegments(in directory: URL) throws -> [Int] {
        try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .compactMap { url -> Int? in
                let name = url.lastPathComponent
                guard name.hasPrefix("seg-"), !name.hasSuffix(".partial") else { return nil }
                return Int(name.dropFirst(4))
            }
            .sorted()
    }

    private func discardPartials(in directory: URL) throws {
        for url in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        where url.lastPathComponent.contains(".partial") {
            try? FileManager.default.removeItem(at: url)
        }
    }

    private func freeBytes() -> Int64 {
        guard let directory = recordingDirectory else { return -1 }
        let values = try? directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values?.volumeAvailableCapacityForImportantUsage ?? -1
    }
}
