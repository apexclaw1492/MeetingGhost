# iPhone Reliability Test Report — v10.0

**Device:** David's iPhone XIV — iPhone 14 Pro (iPhone15,2), iOS 26.5
**Build type:** Release (`xcodebuild -configuration Release`, automatic signing, team NDZXSR63GJ)
**App version:** v10.0 (commit — see git log)
**Honesty labels:** each result is marked `build-verified`, `preview-verified`
(desktop browser at 390×844, IndexedDB backend, same TS code paths), or
`device-verified` (ran on the physical iPhone). Only device-verified results
count toward the acceptance criteria.

## Verification already performed by the agent

| What | Result | Evidence level |
|---|---|---|
| Web build + oxlint | pass | build-verified |
| iOS Release build incl. FreeDiskPlugin.swift (arm64) | pass | build-verified |
| Android assembleDebug | pass | build-verified |
| Meeting record exists the moment recording starts | pass (`status:'recording'` in History ~1s after tap) | preview-verified |
| 60s segment rotation writes+verifies during recording | pass (seg-0, 966KB at t=60s, recording continued) | preview-verified |
| Kill (reload) mid-recording at t≈78s | pass — BOTH segments survived (pagehide flush caught the 17s tail); recovery chip + Retry + playable audio after relaunch | preview-verified |
| Disk reconciliation on relaunch | pass (`recover.recording: segsOnDisk=2, segsBelieved=2`) | preview-verified |
| Multi-segment transcription, boundary stitching | pass (2 segments, 594 chars, verbatim, no dup/loss at boundary) | preview-verified |
| Kill mid-transcription at checkpoint tNext=1 | pass — part 1 transcript survived; status `transcription_interrupted at 2/2 — resumable` | preview-verified |
| Resume from checkpoint | pass (`transcribe.start from:1`; only segment 2 re-processed; final transcript identical to uninterrupted run) | preview-verified |
| Saved-vs-transcribed distinction | pass ("Recording safely saved — 00:18, 0.3 MB in 3 segments…" banner; separate transcription state) | preview-verified |
| Storage display while recording | pass ("3.1 GB free" chip; native path uses FreeDiskPlugin — needs device run) | preview-verified |
| Contrast / 5-tab mobile nav / no clipping at 390pt | pass (screenshots) | preview-verified |
| Install on physical iPhone | **blocked: device locked during install attempt** — retry pending | — |

## Device test matrix (fill in as each test is run on the phone)

Results template — mark PASS/FAIL + notes. See `.agent/IPHONE_TEST_PROTOCOL.md`
for the full procedure of each numbered test.

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | 30 s record/save/transcribe | | |
| 2 | 2 min record/save/transcribe | | |
| 3 | 15 min record | | |
| 4 | 60 min record | | |
| 5 | ≥2 h record | | |
| 6 | Screen lock mid-recording | | |
| 7 | Background/foreground ×10 | | |
| 8 | Call/Siri interruption | | |
| 9 | Bluetooth connect/disconnect | | |
| 10 | Force-quit during transcription → recover | | |
| 11 | Force-quit during recording → recover | | |
| 12 | Phone restart before transcription | | |
| 13 | Low storage warn + auto-stop | | |
| 14 | Mic permission denied → re-granted | | |
| 15 | No model installed → save + guided retry | | |
| 16 | Kill at transcription start | | |
| 17 | Retry/resume correctness | | |
| 18 | Full playback of long recording | | |
| 19 | Duration shown vs audible length | | |
| 20 | 25× consecutive 2-min runs | /25 saved, /25 auto-transcribed | |

## Known limitations (honest)

1. A hard force-quit can lose up to the last 60 s (in-flight segment). Lock/
   background triggers an immediate flush, so the practical loss window is
   seconds. Verified zero-loss on reload-kill in preview; device behavior on
   true force-quit must be confirmed (test 11).
2. Background recording relies on iOS honoring `UIBackgroundModes: audio` for
   WKWebView getUserMedia. If iOS suspends anyway, completed segments are safe
   and the app reports the interruption — it does not pretend to keep recording.
3. On-device summaries need WebGPU (unavailable in WKWebView): phone flow is
   transcript-always, summary via optional BYO Claude key.
4. Imported files are stored as a single segment; a multi-hour import is
   decoded in one piece (recordings are always ≤60 s pieces). 25-min+ imports
   untested on device.
5. Memory-growth across repeated recordings (test 20) requires Xcode
   instrumentation on the device; not measurable in preview.
