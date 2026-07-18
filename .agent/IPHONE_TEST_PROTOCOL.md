# Mobile Physical-Device Test Protocol (v12.25)

**Honesty rule:** "Build verified" = it compiled. "Preview verified" = it passed in a
desktop browser at iPhone dimensions (IndexedDB backend). "Physical-device verified" =
it passed a named test below on an actual iPhone. Only the last one counts toward the
acceptance criteria. Do not claim reliability beyond the evidence.

## Install (release-style build)

Current environment note (2026-07-17): the paired iPhone 14 Pro runs iOS 26.5.2
and the host has Xcode 26.3. The 2026-07-17T13:42:46Z CoreDevice check lists the
iPhone and paired iPad as `unavailable`; the prior signed destination attempt
also could not mount the developer disk image. Installation is blocked until
the phone is connected/unlocked and compatible Xcode device support is present,
or a compatible iPhone is used. No Android device or `adb` is available.

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
7. On first launch, open Settings and confirm the displayed app version is
   **v12.25**. Do not record qualification evidence against a stale installed
   bundle.
8. Run **Meeting Intelligence Integrity Check** and require all eight steps to
   pass, including the production direct-file playback boundary and Metadata-
   loss audio recovery. Confirm its synthetic cleanup does not add a meeting to
   History.
9. Create or restore a completed meeting, reopen the app, and confirm search,
   summary, Markdown, and PDF still work after transcript hydration. For fault
   injection, truncate or alter a test archive and require a visible integrity
   failure plus Recreate Transcript/backup recovery; no partial result may be
   searched, summarized, or shared.

## First-launch setup on the phone

- Grant microphone permission when prompted.
- iOS uses built-in Apple Speech and does not require a Whisper download.
- Android 13+: open AI Models and confirm whether **On-device Speech** is ready.
  If the system model/file-audio capability is unavailable, download **Whisper
  Voice-to-Text** on Wi-Fi and confirm the app labels it as the fallback.
- Web: download **Whisper Voice-to-Text** on Wi-Fi before transcription.
- The optional generative Summarizer requires WebGPU. Where unavailable, the
  built-in private structured summary still works; BYO-key Claude remains an optional upgrade.

## Test matrix (record results in IPHONE_TEST_REPORT.md)

For every test: after the scenario, verify (a) the meeting is in History,
(b) the status chip is accurate, (c) the audio plays, (d) played duration ≈ recorded
duration, (e) Settings → Export Diagnostics contains the relevant events.
Before beginning the physical matrix, run Settings → **Meeting Intelligence
Integrity Check** once. Require all eight steps to pass. On native platforms,
the Markdown and PDF steps must say their prepared share files matched
byte-for-byte; this verifies the final app-controlled file boundary, but tests
24–25 still must prove that real destination apps receive and open those files.

| # | Test | Pass condition |
|---|------|----------------|
| 1 | Record 30 s, stop | "Recording safely saved" banner; transcript completes; audio plays |
| 2 | Record 2 min, stop | Same; transcript covers the whole recording |
| 3 | Record 15 min, stop | Same; approximately 60 native segments; transcription progresses through the exact manifest |
| 4 | Record 60 min, stop | Same; no memory crash during transcription |
| 5 | Record ≥2 h, stop | Same; storage estimate visible while recording |
| 6 | Lock the screen 2 min mid-recording | New audio segments are finalized during the locked interval and audible speech from that interval is present; an interruption is a safe failure but not a reliability pass |
| 7 | Background/foreground ×10 mid-recording | Capture continues through all cycles; no missing interval; flush/session events appear in diagnostics |
| 8 | Incoming call / Siri mid-recording | Interruption notice; completed segments intact |
| 9 | Connect + disconnect Bluetooth mid-recording | Route-change interruption handled; audio preserved |
| 10 | Force-quit DURING transcription → relaunch | Meeting shows "interrupted at n/m — resumable"; Retry resumes from n, not zero |
| 11 | Force-quit DURING recording → relaunch | Recovery notice; every atomically committed segment present; `.partial` tail ignored; ≤15 s tail exposure; Retry transcribes |
| 12 | Restart the phone after stop, before transcription | Meeting + audio intact after reboot; Retry works |
| 13 | Fill storage until <500 MB free, record | Low-storage warning appears; at <100 MB recording auto-stops WITH audio saved |
| 14 | Deny mic permission, try record, re-grant | Clear Settings-path error; works after re-grant |
| 15 | Airplane-mode test | Recording saves. If Apple Speech assets are already present, transcription completes; otherwise the app explains the asset/network requirement and Retry works later; no data loss |
| 16 | Kill the app the moment transcription starts (worker just spun up) | Same as 10 |
| 17 | Retry/resume after any of the above | Resumes from checkpoint; no duplicated/missing text at segment boundaries |
| 18 | Play a 15-min recording end to end | All segments auto-advance; total time ≈ duration shown |
| 19 | Compare shown duration vs audible length (test 2) | Within ±2 s |
| 20 | 25 consecutive 2-min record→save→transcribe runs | 25/25 playable audio; ≥24/25 auto-transcribe; failures recover via Retry; app memory stable (Xcode Debug Navigator) |
| 21 | Speak unique markers at start, middle, and end of a 15-min recording | All three markers appear once in the completed transcript; no missing segment boundary text |
| 22 | Disable optional LLM/cloud, summarize the completed meeting | Private summary contains key points/decision/action from the full transcript and remains after relaunch |
| 23 | Save two meetings, then Ask for an exact marker and a related concept | Exact marker returns its source first; search remains usable with the semantic model disabled or failed |
| 24 | Share Markdown to Notes and Files | Destination receives a `.md` file with title, duration, complete summary/actions, first marker, and final transcript marker |
| 25 | Share PDF to Files and open it | PDF opens, spans all required pages, and contains the final transcript marker on its last transcript page |
| 26 | Force-quit after completion, relaunch, then search/play/export | Archived transcript hydrates completely; search, sequential playback, Markdown, and PDF all still work |
| 27 | Attempt transcription while its engine is unavailable, then restore it | Processing ends visibly, audio remains playable, Retry resumes/completes, and no endless status survives relaunch |
| 28 | Import a 30-minute file, force-quit during a later inference unit, relaunch, Retry | History shows the saved audio and exact chunk position; Retry resumes at the first missing chunk; start/middle/end markers appear once |
| 29 | Import a two-hour file, then search/play/share Markdown and PDF | Import completes without termination or memory pressure; exact final marker is searchable and present in both destination files |
| 30 | Force-quit immediately after a native segment commits, relaunch | Verified audio is rediscovered even if compact meeting metadata is missing; a visible Recovered Meeting appears and is playable/retryable |
| 31 | Android: transcribe a saved marker file with microphone permission denied | Supported native speech transcribes the saved file or fails visibly into fallback; it never records ambient speech |
| 32 | Android: remove/disable the on-device English model, launch, then restore it | Capability state is explicit; no spinner survives; Whisper fallback works; after restore, Retry can use native speech without losing checkpoints |
| 33 | Android: cancel during a later one-minute native import unit, then Retry | Native recognizer/pipe terminates; completed units remain; Retry starts at the first missing unit and final marker appears once |
| 34 | Interrupt the native import completion callback after its atomic file publish | Protected audio is rediscovered as a visible playable meeting; no verified file is deleted; Transcribe Audio resumes normally |
| 35 | Restore a backup over an existing same-ID compact meeting whose transcript archive is missing, then search/share Markdown and PDF | Backup transcript is archived exactly, deterministic summary is restored if absent, search finds the final marker, both destination files contain complete summary/actions and final transcript marker; a valid current transcript is never overwritten |
| 36 | Pause/kill transcription after an early checkpoint, then try GitHub, Calendar, Email, Markdown, PDF, and Share | Every action blocks visibly; no partial transcript or summary is handed off; Retry completes from the checkpoint and all actions then work |
| 37 | Create a summary/action payload whose encoded email draft exceeds 1,800 characters, then tap Email | The app explains the mail-link limit and opens the complete meeting share; the final summary and action markers are present in the destination artifact |
| 38 | Inject/harness a recorder-start bridge stall beyond 30 seconds | Start exits visibly; bounded stop/storage reconciliation runs; verified audio becomes playable/retryable, confirmed-empty removes only the shell, and an uncertain scan retains Recovery Required with no deletion |
| 39 | Web/PWA: let microphone permission resolve only after its 30-second deadline | The UI reports timeout and becomes usable again; the late stream’s tracks stop immediately and no recording indicator/microphone activity remains |
| 40 | Inject an embedding-worker crash during bulk indexing | Every pending index request ends visibly; semantic busy/loading state clears; a replacement worker is installed; hydrated full-text search remains immediately usable |
| 41 | Inject an incomplete, NaN, or mixed-dimension embedding response | The index attempt fails visibly and is retryable; no partial/corrupt vector set replaces an older valid index; lexical search remains usable |
| 42 | Seed a corrupt stored vector record, relaunch, then Ask and rebuild | The meeting is counted as unindexed/rebuildable; corrupt vectors are never ranked; exact lexical results still return; a successful retry replaces the bad record atomically |
| 43 | Stall Whisper, Gemma, and MiniLM initialization without progress | Each model reaches its configured terminal inactivity state, the old worker ends, an inline error and Retry appear, and no progress bar remains indefinitely; saved audio/private summaries/full-text search stay usable |
| 44 | Emit repeated model-init progress beyond the absolute deadline | Preparation still terminates at the hard deadline; late ready/error messages from that generation are ignored and cannot alter the retry state |
| 45 | Relaunch with a cached Whisper model and an interrupted saved meeting | Cached re-warm either becomes ready and bounded auto-resume continues from the saved checkpoint, or ends visibly with saved audio and a model Retry; it never silently abandons or restarts from zero |
| 46 | Native: stall the launch-time speech capability probe | The probe ends within five seconds, records a visible diagnostic reason, and starts bounded Whisper fallback preparation; Android decoder probing also ends within five seconds |
| 47 | Delay native recorder `start` until after its 30-second startup deadline and recovery stop | A late active result triggers another bounded native stop; no invisible recording continues, verified audio is recovered, and the shell remains visibly terminal/retryable |
| 48 | Delay one native recorder listener registration until after startup cancellation | The late listener is detached, platform capture never starts, and no later meeting receives stale recorder events |
| 49 | Stall native speech `cancel` before Retry and after an inference timeout | Each wait ends within five seconds; processing becomes interrupted, audio/checkpoints remain intact, and the UI requires reopen before Retry instead of permitting overlapping recognizers |
| 50 | Stall native import progress-listener attach and removal | File selection/copy or its terminal recovery still proceeds; listener waits end within five seconds and any late listener is detached before another import |
| 51 | Stall native/browser free-space reporting during recorder startup and after a segment commit | The check returns unknown within five seconds; capture/write finalization continues and no serialized segment queue remains blocked behind telemetry |
| 52 | Trigger iOS memory warning / Android `onTrimMemory` while native capture is active | A content-free memory-pressure event contains level, active state, segment/byte/duration metrics, and free space; the UI warns non-blockingly and healthy native capture continues |
| 53 | Export Diagnostics after a complete meeting and after an interrupted transcription | JSON contains no title, transcript, summary, or action-item text; exact-manifest, checkpoint, retained-audio, transcript/summary, and nonterminal assertions accurately pass/fail |
| 54 | Inject a sparse `tParts`/`tSubParts`, out-of-range cursor, duplicate/unsorted segment ID, and resumable state with zero bytes | Diagnostics identifies each invalid invariant; Retry rewinds to the first missing checkpoint and no incomplete export/search result is produced |
| 55 | Record, route-change, background/foreground, interrupt, retry transcription, then stop and export Diagnostics | The event trail includes native start/status, route/interruption, every finalized segment byte/duration/free-space result, transcription attempt/checkpoints, and one visible terminal outcome without meeting content |
| 56 | Replace or backup-repair a transcript while retaining the same meeting ID, then Ask before and after Index All Meetings | The old semantic excerpts never appear; complete lexical search finds the repaired text, the UI reports an outdated index, and rebuild indexes only the exact repaired transcript |
| 57 | Seed a legacy vector array or an envelope with a different embedding schema, then relaunch and export Diagnostics | Ask excludes it, the meeting is rebuildable, diagnostics increments `staleOrMissing` without content/fingerprints, and a successful rebuild clears the count |
| 58 | Seed 500 current semantic indexes, then relaunch, open Ask, and export Diagnostics under slow-storage injection | Freshness/count completes through one bounded bulk transaction rather than 500 sequential waits; the UI remains responsive and counts only transcribed meetings |
| 59 | Start indexing a large multi-meeting archive, Cancel during a later transcript, then inject the 15-minute job deadline on Retry | Each run exits visibly; every fully verified earlier meeting remains indexed, the partial current meeting is not committed, Index Remaining Meetings resumes it, and full-text search remains available throughout |
| 60 | Restore 500 archived multi-hour transcripts, cold-launch, open History, search the final record, Ask, and index remaining meetings while watching WebView memory | Launch/History do not render all bodies; archive reads are sequential; search and Ask find exact final markers; View/Hide loads/releases one body; memory remains bounded without termination |
| 61 | Delete or alter a middle transcript archive, then run History search, Ask, and indexing; restore it and retry | Each consumer stops visibly without a partial result or endless state; saved audio/backup recovery remains available; after verified repair, Retry completes and finds the exact marker |
| 62 | Restore 400 archived two-hour transcripts, search/Ask for the final marker under storage throttling | History and Ask show exact completed/total progress, access one archive at a time, find the final source, and terminate visibly at the five-minute safety boundary if storage cannot finish |
| 63 | Start a 400-meeting backup, Cancel during transcript verification, then Retry | Cancel ends visibly and re-enables Backup; verified archives and inline bodies remain unchanged; Retry produces a complete 400-meeting file |
| 64 | Restore a large backup while one middle archive write fails or the app is killed | Archiving remains sequential; every verified earlier body stays durable, the failed/not-yet-written body remains complete inline, relaunch retries safely, and no partial meeting replaces current valid content |

## What the app guarantees by design (verified in preview, must be confirmed on device)

- The meeting record exists in History from the moment recording starts.
- Production mobile audio originates in native AVAudioRecorder/MediaRecorder,
  writes directly to the app container, and atomically commits 15-second
  verified segments. Browser/PWA capture retains the 60-second Web recorder.
- Transcription runs only on saved audio, one segment at a time, checkpointed after
  each segment (`tNext`), resumable, cancelable (cancel keeps audio), 5-min stall watchdog.
- Interrupted states are reconstructed from disk at launch — never an endless spinner.
- Storage is checked before recording and at every segment; warn <500 MB, stop <100 MB.

## Known limitations (state these honestly)

- A force-quit can lose only the current uncommitted native target segment
  (≤15 s by design). A `.partial` file is never listed as completed. This still
  requires physical kill/relaunch proof before it is treated as guaranteed.
- v12.25 owns capture in native iOS/Android code rather than only holding a
  background session; it must still pass the physical lock tests.
- A deterministic private structured summary works without WebGPU or an API
  key; optional AI can refine it.
- Uploads are stored as one durable segment. v12.25 native iOS/Android pickers
  stream directly to protected storage and process one-minute native units;
  native playback also streams that protected file directly without a complete
  base64 copy in WebView memory;
  web still performs whole-file browser decode before its five-minute
  checkpointed inference units. Tests 28–29 are release gates, not current
  guarantees. Mobile recordings target 15-second pieces; browser recordings
  remain ≤60-second pieces.

## Qualification order

Run tests 1, 6, and 7 first. If any locked/background interval is missing,
stop and diagnose the v12.25 native recorder/session events before attempting
longer qualification. After it passes, run 3, 4, and 5 in order,
then interruptions, recovery, low-storage, playback, and the 25-cycle matrix.
