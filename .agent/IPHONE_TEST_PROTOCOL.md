# iPhone 14+ Physical-Device Test Protocol (v10)

**Honesty rule:** "Build verified" = it compiled. "Preview verified" = it passed in a
desktop browser at iPhone dimensions (IndexedDB backend). "Physical-device verified" =
it passed a named test below on an actual iPhone. Only the last one counts toward the
acceptance criteria. Do not claim reliability beyond the evidence.

## Install (release-style build)

1. Connect the iPhone via USB, unlock it, tap **Trust This Computer**.
2. In Xcode: open `ios/App/App.xcodeproj`, select the App target →
   Signing & Capabilities → pick your Team (personal team works for direct install).
3. Select the physical device in the run-destination picker.
4. Product → Scheme → Edit Scheme → Run → **Build Configuration: Release**.
5. Product → Run (⌘R). First run: on the phone, Settings → General →
   VPN & Device Management → trust the developer certificate.
6. From the repo root, before building:
   `npm run build && npx cap sync ios`
   (TestFlight alternative: Product → Archive → Distribute → TestFlight.)

## First-launch setup on the phone

- Grant microphone permission when prompted.
- AI Models tab → download **Whisper Voice-to-Text** on Wi-Fi (~40 MB real download).
- The Summarizer requires WebGPU and will be unavailable — expected; transcription
  and the BYO-key Claude tier are the phone paths.

## Test matrix (record results in IPHONE_TEST_REPORT.md)

For every test: after the scenario, verify (a) the meeting is in History,
(b) the status chip is accurate, (c) the audio plays, (d) played duration ≈ recorded
duration, (e) Settings → Export Diagnostics contains the relevant events.

| # | Test | Pass condition |
|---|------|----------------|
| 1 | Record 30 s, stop | "Recording safely saved" banner; transcript completes; audio plays |
| 2 | Record 2 min, stop | Same; transcript covers the whole recording |
| 3 | Record 15 min, stop | Same; segments ≈ 15; transcription progresses n/15 |
| 4 | Record 60 min, stop | Same; no memory crash during transcription |
| 5 | Record ≥2 h, stop | Same; storage estimate visible while recording |
| 6 | Lock the screen 2 min mid-recording | Segments continue (UIBackgroundModes audio) OR interruption is surfaced honestly; nothing recorded before the lock is lost |
| 7 | Background/foreground ×10 mid-recording | Same as 6; flush events in diagnostics |
| 8 | Incoming call / Siri mid-recording | Interruption notice; completed segments intact |
| 9 | Connect + disconnect Bluetooth mid-recording | Route-change interruption handled; audio preserved |
| 10 | Force-quit DURING transcription → relaunch | Meeting shows "interrupted at n/m — resumable"; Retry resumes from n, not zero |
| 11 | Force-quit DURING recording → relaunch | Recovery notice; all rotated segments present; ≤60 s tail loss max; Retry transcribes |
| 12 | Restart the phone after stop, before transcription | Meeting + audio intact after reboot; Retry works |
| 13 | Fill storage until <500 MB free, record | Low-storage warning appears; at <100 MB recording auto-stops WITH audio saved |
| 14 | Deny mic permission, try record, re-grant | Clear Settings-path error; works after re-grant |
| 15 | Airplane-mode fresh install (no model), record | Recording saves; "install Whisper, then Retry" message; no data loss |
| 16 | Kill the app the moment transcription starts (worker just spun up) | Same as 10 |
| 17 | Retry/resume after any of the above | Resumes from checkpoint; no duplicated/missing text at segment boundaries |
| 18 | Play a 15-min recording end to end | All segments auto-advance; total time ≈ duration shown |
| 19 | Compare shown duration vs audible length (test 2) | Within ±2 s |
| 20 | 25 consecutive 2-min record→save→transcribe runs | 25/25 playable audio; ≥24/25 auto-transcribe; failures recover via Retry; app memory stable (Xcode Debug Navigator) |

## What the app guarantees by design (verified in preview, must be confirmed on device)

- The meeting record exists in History from the moment recording starts.
- Audio streams to the app container (native Filesystem) in ≤60 s verified segments;
  a kill at any moment loses at most the in-flight segment.
- Transcription runs only on saved audio, one segment at a time, checkpointed after
  each segment (`tNext`), resumable, cancelable (cancel keeps audio), 5-min stall watchdog.
- Interrupted states are reconstructed from disk at launch — never an endless spinner.
- Storage is checked before recording and at every segment; warn <500 MB, stop <100 MB.

## Known limitations (state these honestly)

- A force-quit can lose up to the last 60 s (the un-rotated in-flight segment).
  Backgrounding/locking triggers an immediate flush, so the practical window is smaller.
- Background recording depends on iOS honoring `UIBackgroundModes: audio` for WKWebView
  `getUserMedia`; if iOS suspends anyway, the app says so rather than pretending.
- The on-device summarizer needs WebGPU (absent in WKWebView) — transcripts work,
  summaries need a Claude API key.
- Uploads are stored as ONE segment: a multi-hour imported file is decoded in one piece
  (recordings are not affected — they are always ≤60 s pieces).
