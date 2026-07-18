# Reliability Architecture Options — v12.26

**Decision date:** 2026-07-17

## Objective evidence

- A physical iPhone 14 Pro Release run passed 15 continuous minutes, 15/15
  durable segments, Apple Speech transcription, and stable process identity.
- The first physical 60-minute v12.0 locked/offline attempt failed after its
  first finalized segment; save-first recovery worked, continuous capture did not.
- v12.16 retains microphone ownership and 15-second segment finalization in
  `AVAudioRecorder` on iOS and the Android foreground service itself. Both
  compile, but neither has passed the required physical lock plus 60-/120-minute
  matrix.
- Summary, full-text search fallback, complete Markdown/PDF export, transcript
  archival/hydration, and hours-scale bounded regression fixtures pass in
  automated/browser validation. The v12.10 bundle also rediscovers verified audio
  without compact meeting metadata in its eight-step integrity check. iOS and
  Android imports now stream-copy and process bounded one-minute native units;
  Android 13+ now has a support-checked native saved-audio SpeechRecognizer
  path with a bounded Whisper fallback. Mobile long-import behavior and both
  Android inference paths remain unproven on physical devices.
- The final v12.10 APK passed the full eight-step two-hour-equivalent pipeline
  on an isolated API 34 emulator. Audio recovery, exact transcript hydration,
  summary, search, complete Markdown/PDF generation, byte-for-byte readback of
  both native share files, and cleanup passed with an empty integrity-run error
  log. This closes the app-controlled Android export-file boundary; it does not
  replace physical recording/transcription soaks or receiving-app share tests.
- Android cold-service recovery now rebuilds its durable manifest and metrics
  before persisting a recovery STOP. This closes a source-level race that could
  erase the authoritative recovery response while leaving audio on disk. Four
  focused JVM tests plus assemble/lint pass; physical force-kill/relaunch proof
  remains a release gate.
- v12.12 production transcript, Markdown, and PDF exports now read back the
  exact native cache file before URI resolution; injected truncation stops
  visibly without opening a share sheet. All 32 tests, web build/lint, native
  asset sync, unsigned iOS Simulator build, and Android 4/4 unit/assemble/lint
  pass. Real receiving-app proof is still a physical qualification gate.
- v12.13 removes whole-file base64 playback for native recordings/imports,
  preserves atomically published audio across failed import callbacks, and
  persists the deterministic summary before bounded optional refinement. All
  38 tests and native build gates pass; physical validation is still required.
- v12.14 repairs duplicate-ID backups when the current transcript archive is
  missing and restores a deterministic summary before complete-transcript
  export. All 43 tests and native build gates pass; physical restore/share
  validation remains required.
- v12.15 applies the same complete-transcript/summary gate to GitHub, Calendar,
  Email, startup hydration, and backup workflows; blocks interrupted partial
  exports; removes silent email truncation; and bounds GitHub requests. All 46
  tests and native build gates pass.
- v12.16 bounds microphone/startup waits, closes late permission streams, makes
  haptics non-blocking, and reconciles timed-out startup without deleting
  uncertain audio. All 51 tests and native build gates pass.
- v12.17 rejects incomplete, non-finite, and mixed-dimension semantic batches
  before atomic index replacement; treats corrupt stored indexes as rebuildable;
  and replaces a crashed embedding worker while full-text search stays usable.
  All 54 tests, native build gates, and the eight-step web integrity run pass.
- v12.18 gives initial download/re-warm for Whisper, Gemma, and MiniLM correlated
  generations, inactivity and absolute deadlines, stale-reply rejection,
  persisted inline Retry states, and clean-worker replacement. Native speech and
  decoder probes now terminate within five seconds so fallback preparation is
  never held behind an unbounded bridge. All 57 tests and native build gates pass.
- Remaining evidence gap is now primarily physical: the timeout/fallback behavior
  must be injected under real mobile suspension/memory pressure, and the native
  recorder/STT/export matrix still must prove locked hours-long operation.
- v12.19 closes late native recorder-start races and bounds native speech
  cancellation, recorder flush/listener cleanup, import-listener lifecycle, and
  free-space probes. A late active start is stopped again; uncertain recognizer
  cleanup requires a safe reopen. All 59 tests and native build gates pass.
- v12.20 adds strict content-free diagnostic assertions for manifests,
  transcription checkpoints, retained audio, transcript/summary completion,
  and nonterminal states. Native memory pressure, session reconciliation,
  routes/interruptions, finalized bytes/duration, storage results, retries, and
  terminal outcomes are captured for the physical matrix. All 65 tests and
  native build gates pass.
- v12.21 closes the remaining known silent transcript-archive corruption gap:
  complete text retains expected counts and a whole-body fingerprint; search,
  summary, indexing, backup, and every export reject missing/truncated/altered
  archives; verified legacy migration and duplicate-ID backup repair remain
  available. All 69 tests, native build gates, a 1,408,889-character browser
  storage round-trip, and the eight-step web integrity run pass.
- v12.22 prevents stale semantic excerpts after same-ID transcript repair or
  embedding changes. Index envelopes require exact transcript integrity, chunk
  text, and model schema; legacy/corrupt/stale indexes are visibly rebuildable,
  excluded from Ask, and counted content-free in diagnostics while lexical
  search continues. All 73 tests, native build gates, real browser IndexedDB
  proof, large archive round-trip, and eight-step web integrity run pass.
- v12.23 closes the cumulative semantic-job terminality gap: freshness is one
  bulk transaction rather than one timed transaction per meeting; indexing has
  visible meeting/chunk progress, Cancel, a 15-minute hard deadline, retained
  per-meeting commits, and resumable remaining work. A 500-meeting regression,
  all 74 tests, native build gates, and rendered browser checks pass.
- v12.24 removes eager whole-library transcript hydration. Startup and History
  keep archived bodies out of WebView memory; History search, Ask, and indexing
  verify one archive at a time; View/Hide explicitly loads and releases one
  transcript. A 500-archive concurrency regression, all 76 tests, native build
  gates, and rendered search/view/hide proof pass.
- v12.25 closes whole-library job terminality and backup concurrency gaps.
  History/Ask show exact progress and have five-minute deadlines; hydration,
  legacy migration, and restore archive sequentially; backup work has progress,
  Cancel, a 15-minute boundary, and loss-safe Retry. All 79 tests, native build
  gates, and a rendered 400-meeting cancel/retry workflow pass.
- v12.26 closes the current known support-operation and accessibility contract
  gaps: loss-safe deletion, bounded visible diagnostics/integrity/clipboard
  failures, opt-in model downloads, local system fonts, visible focus, reduced
  motion, 48px coarse targets, and named modal/navigation/form/progress/live
  semantics. All 87 tests and native build gates pass; rendered mobile-width
  diagnostics and all eight integrity stages pass without browser issues.

The app therefore has a strong durable data pipeline, but it is not yet an
hours-long mobile recorder with release-grade evidence.

## Three practical paths from v12.26

1. **Qualify the current local-first stack (recommended first).** Keep native
   segmented capture, Apple Speech, support-checked Android system speech, and
   Whisper fallback. Spend effort on the physical matrix, diagnostics, and
   fault injection before adding another engine.
2. **Bundle a native Android model for consistent coverage.** Add whisper.cpp
   or sherpa-onnx behind the same one-minute checkpoint contract. This reduces
   dependence on device speech assets but increases download size, ABI work,
   memory/performance variation, and maintenance.
3. **Offer opt-in managed transcription.** Preserve local recording/recovery,
   then upload encrypted resumable chunks only with consent. This can improve
   coverage and accuracy but adds network, privacy, account, backend, and
   per-minute cost obligations; it should not silently replace the local path.

## Option A — retain WebView capture on web only

Keep `MediaRecorder` only for the PWA/web target. v12.26 no longer selects this
path for production iOS/Android recording.

- **Advantages:** keeps the browser target dependency-free and uses broadly
  supported web APIs while the page remains active.
- **Risks:** browsers may suspend capture when a PWA is backgrounded; do not
  extend web evidence to native mobile reliability claims.
- **Use:** browser/PWA recording and the microphone-free synthetic test harness.

## Option B — native capture, existing Capacitor UI (recommended)

Retain React, all screens, storage schema, summaries, search, exports, and the
save-first state machine. Replace only microphone capture:

- iOS: AVAudioEngine or AVAudioRecorder owns capture, interruptions, routes,
  background audio, and direct file finalization.
- Android: foreground service owns MediaRecorder/AudioRecord, wake lock,
  notification, routes, and direct file finalization.
- Finalize 5–15-second independently playable segments, verify file size and
  duration natively, then emit progress events to JavaScript.
- Reconcile native session manifests on launch before resuming transcription.

**Advantages:** addresses the failed layer directly, minimizes rewrite risk,
preserves the completed product/UI, and gives the OS-native lifecycle control
needed for locked multi-hour sessions.

**Costs/risks:** two platform implementations, audio-format normalization,
native test harnesses, and careful interruption/route handling.

This is the recommended production architecture and is now implemented in
v12.26 source/build. It remains a release blocker until the physical matrix
proves it.

## Option C — Option B plus native transcription on both platforms

Use native capture, Apple Speech on iOS, and the v12.26 support-checked Android
13+ on-device SpeechRecognizer for saved audio. Keep inference segment-by-
segment with the current checkpoint/retry protocol. If the qualified device
matrix shows unacceptable service/model coverage, replace the compatibility
fallback with a bundled native engine such as whisper.cpp or sherpa-onnx.

- **Advantages:** strongest private/offline design; removes WebView memory risk
  from Android transcription; predictable long-session memory.
- **Costs/risks:** model packaging/downloads, ABI/device performance variance,
  native library maintenance, and a larger Android qualification matrix.

Recommended as the target state: the system-engine form is implemented. Broad
Android release still waits for hardware qualification and a measured decision
on whether its device coverage is sufficient.

## Option D — opt-in managed cloud transcription

Use native capture and resumable encrypted chunk upload to a transcription
provider, while retaining local audio and retry state.

- **Advantages:** typically better diarization/accuracy and less on-device
  inference pressure; easier support for older devices.
- **Costs/risks:** network dependency, ongoing per-minute cost, privacy and
  consent obligations, account/backend operations, and conflict with the
  product's local-first promise.

This can be an optional tier, not the only reliable path, unless the product
vision changes explicitly.

## Option E — full Swift/Kotlin, Flutter, or React Native rewrite

A rewrite would still require the same native audio and lifecycle work while
recreating screens, persistence, search, export, and tested recovery behavior.
It increases regression surface without directly solving more than Option B.
Do not choose this solely for recording reliability.

## Recommended sequence and release gates

1. Preserve v12.26 and install a fresh signed build on both target platforms.
2. Qualify the implemented Option B path: 15-second native segments, atomic
   partial-to-final commits, and native session recovery.
3. Pass iOS: lock, background ×10, 15m, 60m, 2h, interruption/route, restart,
   low storage, kill recovery, playback, export, and memory.
4. Qualify native Android STT (Option C) and its fallback on a lower-memory
   device and a current flagship; require microphone-denied saved-file proof.
5. Qualify v12.26’s iOS/Android native streamed import, direct playback, import
   recovery, and one-minute processing
   with 30-minute/two-hour files. Keep the v12.6+ inference checkpoints.
6. Ship only when finalized audio has zero observed loss across the matrix,
   no locked interval is missing, transcription always completes or resumes,
   and complete hydrated exports open successfully in real destination apps.

Suggested service targets:

- ≥99.5% automatic successful save across qualified sessions.
- 100% recovery of every acknowledged/finalized segment after process death.
- ≤15 seconds maximum unfinalized tail exposure.
- 100% of transcription failures end in a visible retryable state, never an
  endless spinner or silent truncation.
- 100% of completed-meeting export fixtures contain the final transcript byte
  and open in at least Notes/Files/Mail or Android equivalents.
