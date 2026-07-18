# Reliability Delivery Backlog — v12.26

**Status labels:** implemented means source exists; build-verified means it
compiled/tested; device-qualified means it passed the named physical matrix.
Only device-qualified work can close a mobile reliability requirement.

## P0 — release blockers

- [x] **Replace WebView microphone capture with native segmented capture.**
  v12.26 uses iOS AVAudioRecorder and Android foreground-service MediaRecorder,
  15-second atomic commits, app-private files, native events, and orphan-session
  recovery. Build-verified only; the qualification tasks below remain open.
- [ ] **Qualify v12.26 on a physical iPhone.** Fresh signed install, 30s,
  screen-lock, background/foreground ×10, 15m, 60m, 2h, call/Siri, Bluetooth,
  restart, low storage, permission denial, kill/recovery, playback, memory.
  Current paired iPhone runs iOS 26.5.2; Xcode 26.3 cannot mount its developer
  disk image, so update Xcode/device support or use a compatible device first.
- [ ] **Qualify on at least one lower-memory and one current Android device.**
  Confirm foreground notification/service, screen lock, Doze, interruptions,
  60m/2h capture, storage thresholds, playback, and process recovery. An
  isolated API 34 emulator now boots, installs, launches, and proves plugin
  registration plus the visible model-unavailable fallback; it does not replace
  the lower-memory/flagship physical matrix. No physical Android is connected,
  and `adb` is not currently available in this shell.
- [x] **Move supported Android STT out of the WebView.** Android 13+ now uses a
  support-checked on-device SpeechRecognizer file-audio pipe, native one-minute
  decode, three-minute terminal deadline, explicit cancel, and the existing
  durable checkpoint/retry contract. If exact file-audio support or the English
  model is missing, it fails closed and retains bounded Whisper as compatibility
  fallback. Build/emulator verified; physical-device qualification remains open.
- [x] **Shorten source-level worst-case tail exposure.** Native recorders target
  15-second segments and publish only an atomically renamed, byte-verified file;
  a killed `.partial` file is ignored. Physical proof remains required.
- [x] **Add release telemetry/diagnostic assertions.** v12.26 exports content-free
  assertions for exact manifests, durable checkpoint prefixes/bounds, retained
  audio, completed transcript/summary outcomes, and nonterminal states. Native
  session snapshots, route/interruption changes, finalized file size/duration,
  retries, iOS/Android memory pressure, free-space results, and terminal outcomes
  are recorded without titles, transcripts, summaries, or action-item text.
- [x] **Make completed transcript integrity durable.** v12.21 stores explicit
  text/no-speech outcomes, character/byte counts, and a versioned whole-body
  checksum; every hydration consumer fails closed on truncation/corruption,
  legacy archives migrate safely, and backup repair re-verifies before compaction.
- [x] **Make destructive deletion loss-safe and observable.** v12.26 keeps the
  meeting visible until audio, transcript, and vector deletion all succeed;
  partial/stalled deletion ends visibly and remains retryable.
- [x] **Bound support operations.** Diagnostics export has a 60-second whole-job
  deadline and visible busy/failure/success states; the integrity check has a
  15-minute boundary; clipboard failure is visible.

## P1 — hours-scale completeness

- [ ] Physically qualify v12.26 native streamed copy, direct playback, import
  completion recovery, and one-minute processing
  with 30-minute and two-hour imports on iOS and Android. Both native picker
  boundaries are implemented; Apple Speech and MediaCodec execution remain
  device-unproven. Browser import remains a compatibility path.
- [ ] Add automated native interruption/route/service tests where the platform
  permits them, plus nightly two-hour soak runs on real devices.
- [ ] Run accessibility QA at default and largest Dynamic Type/font scaling,
  VoiceOver/TalkBack, Display Zoom, and 320–430pt widths. v12.26 source/browser
  contracts pass; assistive-technology and physical-device evidence is pending.
- [ ] Run an end-to-end export matrix: Markdown share to Notes/Mail/Files,
  multi-page PDF, backup/restore, and source-app summary handoff.
- [ ] Define supported device/OS floor from measured transcription time and
  peak memory rather than from compile compatibility alone.

## Source and native build verified through v12.26

- [x] Save-first 60-second verified segments and exact segment manifests.
- [x] Idempotent stop, in-flight rotation wait, storage warning/auto-stop.
- [x] Resumable per-segment transcription with crash/time-out handling.
- [x] Native Apple Speech on iOS; support-checked native Android 13+ speech;
  Web Whisper and explicit unsupported-Android Whisper fallback.
- [x] Deterministic local summary and full-text cross-meeting search fallbacks.
- [x] Hydrated transcript export, paginated PDF, actual Markdown native share.
- [x] IndexedDB v2 large-transcript archival with exact read-back verification,
  durable expected lengths/checksum, corruption rejection, and legacy migration.
- [x] Larger readable mobile text/icons and 44–60px core touch targets.
- [x] System fonts/text scaling, 48px coarse-pointer targets, visible keyboard
  focus, reduced motion/forced colors, and named modal/navigation/forms/progress/
  status semantics; optional model downloads require an explicit choice.
- [x] Request-correlated transcription/chat/summary/title worker responses.
- [x] Sparse-checkpoint rewind and complete-segment assembly assertion.
- [x] Hydration-first lexical search fallback when semantic retrieval fails.
- [x] Bounded, commit-aware IndexedDB open/transactions.
- [x] Visible/retryable playback failures and incomplete-export blocking.
- [x] 69 tests, build, lint, final-page export checks, truncation/alteration fault checks,
  and local-browser checks.
- [x] Model-unavailable transcription terminates visibly; native engine startup
  probe, optional-summary timeout, and storage-pressure recovery are bounded.
- [x] Literal Ask results precede semantic suggestions; native PDF sharing is
  file-based; playback and Retry honor repaired exact manifests.
- [x] On-device synthetic two-hour integrity check covers actual audio
  write/read/decode, metadata-loss manifest rediscovery, transcript hydration,
  temporal summary, exact search, complete Markdown/PDF, cleanup, and visible
  per-step failures. The installed v12.10 Android APK passed all eight steps;
  both complete native share files matched byte-for-byte after cache write/read,
  the process remained alive, and cleanup left no synthetic artifact. Real
  destination-app receipt remains in the physical export matrix.
- [x] Decoded web/Android imports use contiguous five-minute Whisper inference
  units with durable per-unit checkpoints, gap-safe assembly, visible resume
  position, and terminal timeouts around import/save/playback/export prep.
- [x] Native iOS/Android capture owns microphone and rotation outside WebView,
  commits 15-second partial files atomically, bounds finalization, and exposes
  restart/interruption/storage failures as recoverable meeting state.
- [x] Startup enumerates exact audio storage independently of compact meeting
  metadata and recreates a visible recovery shell for verified orphan audio.
- [x] Android native picker streams imports directly to a partial file with
  progress, storage floor, fsync, exact byte verification, atomic publish, and
  a terminal copy deadline; no full import blob crosses the WebView.
- [x] Android native MediaExtractor/MediaCodec decodes app-private audio into
  contiguous one-minute 16 kHz PCM units with length verification and durable
  per-unit transcript checkpoints; the two-hour fixture produces 121 exact
  units including its final 321 ms tail.
- [x] iOS native document picker stream-copies imports into the same protected
  recording store with progress, storage floor, fsync, exact verification,
  atomic publish, and a terminal copy deadline; no full import Blob crosses
  WKWebView.
- [x] Apple Speech receives contiguous one-minute native CAF units with durable
  per-unit checkpoints. A two-hour/121-unit fixture proves Retry continues at
  the first missing unit and complete assembly includes the final unit.
- [x] Apple Speech exposes explicit native cancellation; Pause, Cancel, and
  watchdog failure terminate native work before Retry can start a replacement.
- [x] Android native speech checks the exact saved-audio intent before every
  recognition request, never starts an unverified microphone-fallback request,
  and terminates silence, unsupported-model, timeout, cancel, and recognizer
  errors explicitly.
- [x] Isolated API 34 x86 emulator: fresh install/cold launch, NativeSTT plugin
  registration, native MediaCodec availability, English-model-unavailable
  terminal probe, Whisper fallback initialization, and first-run/Studio visual
  render verified. An emulator System UI ANR occurred under host load; the
  MeetingGhost process remained alive and produced no AndroidRuntime crash.
- [x] Android cold-service recovery rehydrates the protected recording snapshot
  before a recovery STOP can persist terminal state. Four JVM fault-injection
  tests prove sparse exact manifests, byte totals, failed/next indexes, duration,
  partial-tail cleanup, and safe meeting IDs. Physical kill/relaunch remains in
  the device matrix.
- [x] Production transcript/Markdown/PDF native exports write and read back the
  exact complete cache payload before URI resolution. Three truncation fault
  tests prove a mismatch never reaches the share sheet; Android text/Markdown
  paths use native Share. Destination-app receipt remains a physical gate.
- [x] Final exact v12.12 native rebuild. Both Capacitor asset syncs, unsigned
  iOS Simulator Debug, Android 4/4 unit tests, `lintDebug`, and `assembleDebug`
  pass. Physical installation remains a separate P0 qualification gate; the
  current paired iPhone still rejects its developer disk image.
- [x] Native hours-long playback resolves protected files directly and cannot
  fall back to a complete base64 WebView read. Missing URIs terminate visibly.
- [x] Native import callback failures scan authoritative storage before cleanup;
  verified audio survives, while an uncertain scan deletes nothing.
- [x] Cloud-enabled summarization commits the deterministic complete result
  immediately and bounds optional refinement input for multi-hour meetings.
- [x] Duplicate-ID backup merge repairs a missing transcript archive from the
  backup while preserving a valid current transcript; recovered content is
  forced through exact archival before compact metadata is persisted.
- [x] Complete-transcript exports repair and persist a missing deterministic
  summary before transcript, Markdown, or PDF generation.
- [x] Final exact v12.13 gate: 38 tests, web build/lint, both native syncs,
  unsigned iOS Simulator Debug, Android 4/4 unit tests, `assembleDebug`, and
  `lintDebug` pass. Physical installation remains a separate P0 gate.
- [x] v12.13 real browser UI integrity run: 8/8 production playback, orphan
  audio recovery, exact transcript hydration, whole-meeting summary, search,
  complete Markdown/PDF, and cleanup; zero browser warnings/errors and zero
  History artifacts after cleanup.
- [x] Final exact v12.14 gate: 43 tests, web build/lint, both native syncs,
  unsigned iOS Simulator Debug, Android 4/4 unit tests, `assembleDebug`, and
  `lintDebug` pass. Physical installation, backup restore, and destination-app
  receipt remain separate P0/P1 gates.
- [x] v12.14 real browser UI integrity run: 8/8 production playback, orphan
  recovery, exact transcript hydration, whole-meeting summary, search, complete
  Markdown/PDF, and cleanup; zero browser warnings/errors and zero History
  artifacts after cleanup.
- [x] GitHub, Calendar, and Email hydrate complete transcript content and repair
  a missing deterministic summary before handoff. Interrupted partial text
  cannot authorize any export.
- [x] Email no longer silently truncates at 1,800 characters; oversized safe-
  mailto payloads visibly use complete meeting share. GitHub header/body reads
  have a terminal 30-second timeout.
- [x] Startup, backup creation, and restore proactively persist missing private
  summaries for completed transcripts.
- [x] Final exact v12.15 gate: 46 tests, web build/lint, both native syncs,
  unsigned iOS Simulator Debug, Android 4/4 unit tests, `assembleDebug`, and
  `lintDebug` pass.
- [x] v12.15 real browser UI integrity run: 8/8 with exact transcript,
  Markdown, and PDF final markers; zero browser warnings/errors and zero
  History artifacts after cleanup.
- [x] Microphone permission and native/web recorder startup have terminal
  30-second deadlines; late browser permission streams are closed immediately.
- [x] Timed-out startup uses bounded stop plus authoritative storage scan.
  Verified audio survives, proven-empty removes only its shell, and uncertain
  evidence retains Recovery Required without deletion.
- [x] Optional haptics are bounded/non-blocking and cannot delay capture or Stop.
- [x] Final exact v12.16 gate: 51 tests, web build/lint, both native syncs,
  unsigned iOS Simulator Debug, Android 4/4 unit tests, `assembleDebug`, and
  `lintDebug` pass.
- [x] v12.16 real browser UI integrity run: 8/8 with exact transcript,
  Markdown, and PDF final markers; zero browser warnings/errors and zero
  History artifacts after cleanup.
- [x] Semantic embedding batches require exact count, finite values, and one
  dimension across all chunks before atomic vector-index replacement.
- [x] Corrupt stored vector records are treated as unindexed/rebuildable and
  skipped during semantic ranking; hydrated lexical search remains available.
- [x] Embedding-worker crashes reject pending requests, clear stale model/busy
  state, install a replacement worker, and surface a visible retry notice.
- [x] Final exact v12.17 gate: 54 tests, web build/lint, both native syncs,
  unsigned iOS Simulator Debug, Android 4/4 unit tests, `assembleDebug`, and
  `lintDebug` pass.
- [x] v12.17 real browser UI integrity run: 8/8 with exact transcript,
  Markdown, and PDF final markers; zero browser warnings/errors and zero
  History artifacts after cleanup.
- [x] Whisper, Gemma, and MiniLM initialization generations have inactivity and
  absolute deadlines; progress cannot keep a preparation alive forever.
- [x] Initialization failure/crash rejects dependent requests, terminates and
  replaces the worker, persists an inline error/Retry state, and ignores stale
  replies from the superseded generation.
- [x] Cached Whisper re-warm keeps bounded automatic resume attached to the
  interrupted saved meeting until ready/terminal; native speech/decoder launch
  probes end within five seconds and fall through safely.
- [x] Final exact v12.18 gate: 57 tests, web build/lint, both native syncs,
  unsigned iOS Simulator Debug, Android 4/4 unit tests, `assembleDebug`, and
  `lintDebug` pass.
- [x] v12.18 real browser UI integrity run: 8/8 with exact transcript,
  Markdown, and PDF final markers; zero browser warnings/errors and zero
  History artifacts after cleanup. A real cached Gemma network-start failure
  also rendered a terminal inline Retry state with fallbacks intact.
- [x] Native recorder cancellation covers listener-registration and platform-
  start races; late listeners detach and a late active start is stopped again.
- [x] Native speech cleanup, recorder flush/listener cleanup, native import
  listener lifecycle, and free-space probes have terminal deadlines. Uncertain
  speech cleanup visibly requires reopen and never discards checkpoints/audio.
- [x] Two native adapter fault tests prove cancellation before listener
  completion and cancellation before platform-start completion cannot create
  invisible capture.
- [x] Final exact v12.19 gate: 59 tests, web build/lint, both native syncs,
  unsigned iOS Simulator Debug, Android 4/4 unit tests, `assembleDebug`, and
  `lintDebug` pass.
- [x] v12.19 real browser UI integrity run: 8/8 with exact transcript,
  Markdown, and PDF final markers; zero browser warnings/errors and zero
  History artifacts after cleanup.
- [x] Diagnostic exports include six strict content-free state assertions and
  detailed per-meeting checkpoint/manifest counts without meeting content.
- [x] Native recorder telemetry records session reconciliation, route and
  interruption state, committed bytes/duration, free space, memory pressure,
  auto-stop, and terminal stop; memory pressure remains non-destructive.
- [x] Final exact v12.20 gate: 65 tests, web build/lint, both native syncs,
  unsigned iOS Simulator Debug, Android 4/4 unit tests, `assembleDebug`, and
  `lintDebug` pass.
- [x] v12.20 real browser UI integrity run: 8/8 with exact transcript,
  Markdown, and PDF final markers; zero browser warnings/errors and zero
  History artifacts after cleanup.
- [x] Completed transcript metadata retains explicit outcome, character/UTF-8
  byte counts, and a versioned whole-body checksum; hydration rejects missing,
  truncated, or same-length altered content before every intelligence consumer.
- [x] Final exact v12.21 gate: 69 tests, web build/lint, both native syncs,
  unsigned iOS Simulator Debug, Android 4/4 unit tests, `assembleDebug`, and
  `lintDebug` pass (371 Gradle tasks).
- [x] v12.21 rendered browser proof: 1,408,889-character transcript archives,
  compacts, and hydrates exactly with integrity metadata; the eight-step
  intelligence check also passes with matching fingerprint and no browser
  warnings/errors.
- [x] Versioned semantic envelopes bind exact transcript integrity, exact chunk
  excerpts, and the embedding contract. Same-ID transcript replacement,
  schema mismatch, corrupt records, and legacy arrays are unindexed/rebuildable;
  stale excerpts cannot reach Ask and lexical search remains available.
- [x] Final exact v12.22 gate: 73 tests, web build/lint, both native syncs,
  unsigned iOS Simulator Debug, Android unit tests, `assembleDebug`, and
  `lintDebug` pass (371 Gradle tasks).
- [x] v12.22 real-browser proof: IndexedDB semantic envelope/current/stale/
  schema checks pass; 1,408,889-character transcript hydration and all eight
  intelligence checks pass with no browser warnings/errors.
- [x] Semantic freshness/count/diagnostics use one bounded bulk IndexedDB read;
  a 500-meeting regression proves no sequential per-meeting transaction chain.
- [x] Whole-library and automatic semantic jobs have a 15-minute hard limit.
  Manual indexing reports meeting/chunk progress, can be canceled, retains
  complete verified indexes, and resumes through Index Remaining Meetings.
- [x] The semantic denominator includes unique transcribed meetings only;
  no-speech and not-yet-transcribed recordings cannot leave a false incomplete
  state.
- [x] Final exact v12.23 gate: 74 tests, web build/lint, both native syncs,
  unsigned iOS Simulator Debug, Android unit tests, `assembleDebug`, and
  `lintDebug` pass (371 Gradle tasks).
- [x] v12.23 browser proof: eight real IndexedDB index checks, exact
  1,408,889-character hydration, and all eight intelligence checks pass with no
  browser warnings/errors.
- [x] Launch/History retain compact metadata only; complete archived transcript
  bodies load through View Complete Transcript and are released through Hide.
- [x] History transcript search, Ask, and whole-library indexing use the shared
  sequential integrity-verified archive scanner; Ask retains bounded top
  candidates and stale semantic excerpts cannot bypass current-body validation.
- [x] A 500-archive regression proves maximum concurrent transcript reads is
  one; missing archive scans fail closed without partial search/index results.
- [x] Final exact v12.24 gate: 76 tests, web build/lint, both native syncs,
  unsigned iOS Simulator Debug, Android unit tests, `assembleDebug`, and
  `lintDebug` pass (371 Gradle tasks).
- [x] v12.24 browser proof: archived two-hour body absent at launch, exact final
  marker found through History search, exact View/Hide lifecycle, eight semantic
  checks, 1,408,889-character hydration, and all eight intelligence checks pass
  with no browser warnings/errors.
- [x] History and Ask library scans show completed/total progress, stop at a
  five-minute absolute deadline, and preserve a visible clean Retry state.
- [x] Whole-library hydration, legacy migration, and backup restore archive one
  transcript at a time; failed archive writes retain the complete inline body.
- [x] Backup export/import expose stage progress, Cancel, a 15-minute job limit,
  and immediate loss-safe Retry.
- [x] Final exact v12.25 gate: 79 tests, web build/lint, both native syncs,
  unsigned iOS Simulator Debug, Android unit tests, `assembleDebug`, and
  `lintDebug` pass (371 Gradle tasks).
- [x] v12.25 rendered proof: 400 archived two-hour records show History/Ask
  progress and final-marker retrieval; backup Cancel terminates visibly and
  Retry completes 400 meetings; integrity/vector/1,408,889-character storage
  checks pass with no browser warnings/errors and exact fixture cleanup.

## Post-reliability product work

- [ ] Automated speaker diarization.
- [ ] Language detection and multilingual transcription qualification.
- [ ] Encrypted cross-device backup/sync.
- [ ] Lock-screen recording controls/live activity after native capture is stable.
