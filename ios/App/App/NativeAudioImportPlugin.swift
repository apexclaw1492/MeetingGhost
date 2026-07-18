import Capacitor
import Foundation
import UniformTypeIdentifiers
import UIKit

/**
 Streams a document-picker audio selection directly into the app's protected
 Documents/recordings directory. The selected file never becomes a JavaScript
 Blob or base64 string, so multi-hour imports do not consume WKWebView memory.

 Only a verified, fsynced `seg-0` is published. A timeout, cancellation, storage
 pressure, provider error, or process death leaves at most a `.partial.import`
 file, which recording recovery deliberately ignores.
 */
@objc(NativeAudioImportPlugin)
public class NativeAudioImportPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "NativeAudioImportPlugin"
    public let jsName = "NativeAudioImport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise)
    ]

    private final class ImportState {
        private let lock = NSLock()
        private var terminal = false
        private var cancelled = false

        func cancelAndFinish() -> Bool {
            lock.lock(); defer { lock.unlock() }
            guard !terminal else { return false }
            terminal = true
            cancelled = true
            return true
        }

        func finish() -> Bool {
            lock.lock(); defer { lock.unlock() }
            guard !terminal else { return false }
            terminal = true
            return true
        }

        var isCancelled: Bool {
            lock.lock(); defer { lock.unlock() }
            return cancelled
        }
    }

    private let copyQueue = DispatchQueue(label: "app.meetingghost.audio-import", qos: .userInitiated)
    private var pendingCall: CAPPluginCall?
    private var pendingMeetingId: String?
    private let copyTimeout: TimeInterval = 10 * 60
    private let stopFreeBytes: Int64 = 100 * 1024 * 1024

    @objc func pick(_ call: CAPPluginCall) {
        guard pendingCall == nil else {
            call.reject("Another audio import is already open.")
            return
        }
        guard let meetingId = call.getString("meetingId"),
              meetingId.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else {
            call.reject("A valid meeting ID is required.")
            return
        }

        pendingCall = call
        pendingMeetingId = meetingId
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.audio], asCopy: false)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        DispatchQueue.main.async { [weak self] in
            guard let self, let viewController = self.bridge?.viewController else {
                self?.clearPending()
                call.reject("The audio picker could not be presented.")
                return
            }
            viewController.present(picker, animated: true)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let call = pendingCall else { return }
        clearPending()
        call.reject("Audio import canceled.", "IMPORT_CANCELED")
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pendingCall, let meetingId = pendingMeetingId, let source = urls.first else {
            clearPending()
            return
        }
        clearPending()
        streamImport(source: source, meetingId: meetingId, call: call)
    }

    private func clearPending() {
        pendingCall = nil
        pendingMeetingId = nil
    }

    private func streamImport(source: URL, meetingId: String, call: CAPPluginCall) {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let directory = documents.appendingPathComponent("recordings", isDirectory: true)
            .appendingPathComponent(meetingId, isDirectory: true)
        let partial = directory.appendingPathComponent("seg-0.partial.import")
        let completed = directory.appendingPathComponent("seg-0")
        let state = ImportState()

        let timeout = DispatchWorkItem { [weak self] in
            guard state.cancelAndFinish() else { return }
            try? FileManager.default.removeItem(at: partial)
            call.reject("Saving imported audio exceeded ten minutes. No incomplete file was published; choose the file again after checking storage.")
            self?.notifyProgress(meetingId: meetingId, phase: "failed", bytes: 0)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + copyTimeout, execute: timeout)
        notifyProgress(meetingId: meetingId, phase: "copying", bytes: 0)

        copyQueue.async { [weak self] in
            guard let self else { return }
            let securityScoped = source.startAccessingSecurityScopedResource()
            defer {
                if securityScoped { source.stopAccessingSecurityScopedResource() }
            }

            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                guard !FileManager.default.fileExists(atPath: completed.path) else {
                    throw ImportError.message("This meeting already has imported audio.")
                }
                try? FileManager.default.removeItem(at: partial)

                var coordinationError: NSError?
                var copyError: Error?
                var copied: Int64 = 0
                let coordinator = NSFileCoordinator()
                coordinator.coordinate(readingItemAt: source, options: [], error: &coordinationError) { coordinatedURL in
                    do {
                        copied = try self.copyBytes(
                            from: coordinatedURL,
                            to: partial,
                            directory: directory,
                            meetingId: meetingId,
                            state: state
                        )
                    } catch {
                        copyError = error
                    }
                }
                if let coordinationError { throw coordinationError }
                if let copyError { throw copyError }
                if state.isCancelled { throw ImportError.message("Audio import timed out.") }

                self.notifyProgress(meetingId: meetingId, phase: "finalizing", bytes: copied)
                let partialSize = try self.fileSize(partial)
                guard copied > 0, partialSize == copied else {
                    throw ImportError.message("Imported audio byte verification failed.")
                }
                try FileManager.default.moveItem(at: partial, to: completed)
                guard try self.fileSize(completed) == copied else {
                    try? FileManager.default.removeItem(at: completed)
                    throw ImportError.message("Final imported audio verification failed.")
                }

                guard state.finish() else {
                    // A deadline may race the final atomic rename. Do not leave
                    // an unacknowledged published file behind after rejection.
                    try? FileManager.default.removeItem(at: completed)
                    return
                }
                timeout.cancel()
                let mimeType = UTType(filenameExtension: source.pathExtension)?.preferredMIMEType ?? "audio/*"
                call.resolve([
                    "bytes": copied,
                    "mimeType": mimeType,
                    "displayName": source.lastPathComponent.isEmpty ? "Imported Meeting" : source.lastPathComponent,
                    "segmentId": 0
                ])
            } catch {
                try? FileManager.default.removeItem(at: partial)
                if state.finish() {
                    timeout.cancel()
                    call.reject("Could not save imported audio: \(error.localizedDescription)")
                }
            }
        }
    }

    private func copyBytes(
        from source: URL,
        to destination: URL,
        directory: URL,
        meetingId: String,
        state: ImportState
    ) throws -> Int64 {
        FileManager.default.createFile(atPath: destination.path, contents: nil)
        let input = try FileHandle(forReadingFrom: source)
        let output = try FileHandle(forWritingTo: destination)
        defer {
            try? input.close()
            try? output.close()
        }

        var copied: Int64 = 0
        var nextProgress: Int64 = 8 * 1024 * 1024
        var nextStorageCheck: Int64 = 0
        while true {
            if state.isCancelled { throw ImportError.message("Audio import timed out.") }
            let data = try input.read(upToCount: 64 * 1024) ?? Data()
            if data.isEmpty { break }
            try output.write(contentsOf: data)
            copied += Int64(data.count)

            if copied >= nextProgress {
                notifyProgress(meetingId: meetingId, phase: "copying", bytes: copied)
                nextProgress = copied + 8 * 1024 * 1024
            }
            if copied >= nextStorageCheck {
                guard availableBytes(at: directory) >= stopFreeBytes else {
                    throw ImportError.message("Storage fell below 100 MB while copying the import.")
                }
                nextStorageCheck = copied + 4 * 1024 * 1024
            }
        }
        try output.synchronize()
        return copied
    }

    private func availableBytes(at url: URL) -> Int64 {
        let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values?.volumeAvailableCapacityForImportantUsage ?? -1
    }

    private func fileSize(_ url: URL) throws -> Int64 {
        Int64(try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
    }

    private func notifyProgress(meetingId: String, phase: String, bytes: Int64) {
        DispatchQueue.main.async { [weak self] in
            self?.notifyListeners("progress", data: [
                "meetingId": meetingId,
                "phase": phase,
                "bytes": bytes
            ])
        }
    }

    private enum ImportError: LocalizedError {
        case message(String)
        var errorDescription: String? {
            guard case let .message(message) = self else { return nil }
            return message
        }
    }
}
