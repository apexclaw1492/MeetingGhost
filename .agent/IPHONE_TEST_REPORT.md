# Mobile Reliability Test Report — v12.25

## Current qualification status (2026-07-17)

| Area | Evidence | Status |
|---|---|---|
| 15-minute iPhone recording + Apple Speech | Physical iPhone 14 Pro Release run, 15/15 segments | **PASS** |
| 25-cycle save/transcribe stability | Physical iPhone 14 Pro prior Release build, 25/25 | **PASS** |
| Locked/background recording on v12.25 | Native capture compiles; no completed physical run | **UNPROVEN** |
| 60-minute / two-hour recording on v12.25 | Earlier WebView path failed; native replacement not run | **FAIL HISTORICALLY / UNPROVEN REPLACEMENT** |
| Android recording/transcription/import | Native capture/import/decode/STT build; API 34 launch and capability fallback verified; no physical device run | **PASS BUILD/EMULATOR / UNPROVEN DEVICE** |
| iOS native import + bounded Apple Speech | Streamed picker and one-minute checkpoint source compile; no physical import | **PASS BUILD / UNPROVEN DEVICE** |
| Summary, search, playback failure UX, long export, transcript archival | 79 automated tests + v12.25 400-meeting progress/cancel/retry proof + installed v12.10 Android full-chain integrity run | **PASS WEB/EMULATOR, NOT DEVICE-SOAKED** |
| Current v12.25 assets/native projects | 79 tests, web build/lint, both native asset syncs, unsigned iOS Simulator build, and Android unit/assemble/lint pass; v12.10 API 34 launch/integrity remains prior runtime evidence | **PASS BUILD; v12.25 DEVICE RUN PENDING** |

Release decision: **do not describe the app as hours-long reliable yet.** The
next decisive evidence is a v12.25 physical native-capture screen-lock run. The
recommended native segmented architecture is now implemented but not yet
qualified; see `.agent/RELIABILITY_OPTIONS.md`.

Live device attempt (rechecked 2026-07-17): David’s iPhone XIV remains paired
as an iPhone 14 Pro running iOS 26.5.2 with Developer Mode enabled, but the
2026-07-17T13:42:46Z `devicectl list devices` result reports it `unavailable`;
the paired iPad is also `unavailable`. The host has Xcode 26.3; the most recent signed Release destination
attempt timed out with “The developer disk image could not be mounted on this device.” No v12.25 app was
installed or run. No physical Android is connected, and `adb` is not currently
available in this shell.

## v12.25 bounded library jobs and sequential backup recovery (2026-07-17)

- History and Ask report completed/total meeting progress while archives are
  verified sequentially and stop at a five-minute absolute boundary. A slow
  storage regression proves timeout is visible rather than an endless scan.
- Whole-library hydration, legacy migration, and backup restore archive one
  transcript at a time. Verified bodies are released from React memory; an
  injected archive failure retains the complete inline transcript.
- Backup export/import expose stage progress, Cancel, and a 15-minute job
  boundary. Cancel preserves all verified/inline content and Retry starts clean.
- 79/79 tests, production build/lint, both Capacitor syncs, unsigned iOS
  Simulator build, and Android unit/assemble/lint pass (371 tasks). APK:
  8,741,906 bytes; SHA-256
  `6e2060a87920406a8771ee1f40c8de85e360d879e94837189bc3d5f4769365f9`.
  Evidence: `.agent/build-evidence-v12.25.json`.
- Rendered v12.25 scanned 400 archived two-hour records with visible History
  (`2/400`) and Ask (`29/400`) progress, found the exact final marker, canceled
  backup visibly, then completed all 400 meetings on Retry. The fresh integrity
  run passed at 8:36:40 AM local, vector/1,408,889-character storage harnesses
  passed, all 400 fixtures were removed, and no browser warning/error occurred.
  Evidence: `.agent/runtime-evidence-v12.25-web.json`.

## v12.24 lazy verified transcript library (2026-07-17)

- Launch and History no longer hydrate/render every archived transcript.
  Complete bodies are loaded one at a time with **View Complete Transcript**
  and released again with **Hide Transcript**.
- History transcript search, Ask, and bulk indexing scan integrity-verified
  archives sequentially. Missing/corrupt archives fail visibly; Ask retains
  only bounded top lexical candidates and validates semantic excerpts against
  the exact current body.
- A 500-archive test proves maximum concurrent archive reads is one; the missing
  archive fault test fails closed. 76/76 tests, production build/lint, both
  Capacitor syncs, exact unsigned iOS Simulator build, and Android
  unit/assemble/lint pass (371 tasks). APK: 8,740,773 bytes, SHA-256
  `39bfef2b80d9222b03a340309914d4ae752ad8a7d6be290c179bb561b3954e67`.
  Evidence: `.agent/build-evidence-v12.24.json`.
- Rendered v12.24 proof showed the two-hour fixture absent from initial DOM,
  searchable by its archived final marker, exactly visible on demand, and gone
  again after Hide. The vector harness, 1,408,889-character archive round-trip,
  and eight-stage intelligence check passed at 8:17:32 AM local with no browser
  warnings/errors. Evidence: `.agent/runtime-evidence-v12.24-web.json`.

## v12.23 bounded semantic indexing at scale (2026-07-17)

- Freshness, launch counts, Ask counts, and diagnostic counts now use one
  bounded IndexedDB bulk read independent of meeting count. A focused
  500-meeting regression proves one `getAll` and zero per-meeting `get` calls.
- Manual semantic indexing reports the current meeting and completed/total
  transcript sections, supports Cancel, and has a 15-minute whole-job deadline.
  Automatic indexing has the same hard boundary. Fully verified earlier
  meeting indexes remain committed; a partial current meeting is not saved;
  Index Remaining Meetings resumes safely and lexical search never stops.
- Only unique text transcripts count toward completion. Explicit no-speech and
  saved-but-untranscribed recordings cannot create a permanent false deficit.
- 74/74 tests, production build/lint, both Capacitor syncs, exact unsigned iOS
  Simulator build, and Android unit/assemble/lint pass (371 tasks). APK:
  8,740,068 bytes, SHA-256
  `8bc76dec5e0adf2ba83fea0742c4531c1ba8a3d8bc0096ece7e6f3ac155a00a8`.
  Evidence: `.agent/build-evidence-v12.23.json`.
- The rendered v12.23 browser passed eight real IndexedDB semantic checks, the
  1,408,889-character exact archive round-trip, and all eight intelligence
  checks at 8:04:23 AM local with no browser warnings/errors. Evidence:
  `.agent/runtime-evidence-v12.23-web.json`.

## v12.22 transcript-bound semantic indexes (2026-07-17)

- A semantic vector envelope is valid only for the exact current transcript
  outcome, character/byte counts, whole-body checksum, derived chunk sequence,
  and MiniLM model/pooling/normalization contract. Same-ID transcript repairs,
  legacy raw arrays, altered excerpts, corrupt vectors, and schema mismatches
  are excluded from Ask and treated as visibly rebuildable.
- Hydrated lexical search remains complete while semantic data is missing or
  stale. Diagnostics report only current/stale counts and never transcript
  content, excerpts, fingerprints, or model output.
- 73/73 tests, production build/lint, both Capacitor syncs, exact unsigned iOS
  Simulator build, and Android unit/assemble/lint pass (371 tasks). APK:
  8,739,281 bytes, SHA-256
  `2f2cfafb58b9df278a2c1559cf052ad6ba981acc6aadf5b132dccab4ff1dcfd6`.
  Evidence: `.agent/build-evidence-v12.22.json`.
- The real browser IndexedDB vector harness passed all seven envelope/current/
  stale/schema checks. The 1,408,889-character transcript archive hydrated
  exactly, and the rendered v12.22 app passed all eight intelligence checks at
  7:51:10 AM local with a 44-page complete PDF and no browser warnings/errors.
  Evidence: `.agent/runtime-evidence-v12.22-web.json`.

## v12.21 durable transcript integrity (2026-07-17)

- Completed text now carries explicit outcome, expected character/UTF-8 byte
  counts, and a versioned whole-body checksum. Missing, non-empty truncation,
  and same-length alteration stop hydration before search, summary, indexing,
  backup, or export. Explicit verified no-speech remains valid; ambiguous empty
  completion is surfaced for recreation from retained audio.
- Legacy archives hydrate and gain integrity metadata before compaction.
  Duplicate-ID backup recovery can repair an unavailable archive, but restored
  text must be written and read back exactly before compact metadata is committed.
- 69/69 tests, production build/lint, both Capacitor syncs, exact unsigned iOS
  Simulator build, and Android unit/assemble/lint pass (371 tasks). APK:
  8,418,894 bytes, SHA-256
  `70997228c06e904c9873a34c99df12680b65383eedcd1515914a83ab48f109c6`.
  Evidence: `.agent/build-evidence-v12.21.json`.
- The rendered v12.21 browser passed a 1,408,889-character archive round-trip
  and all eight intelligence checks at 7:39:01 AM local, including a matching
  fingerprint for the 174,104-character synthetic transcript, with no browser
  warnings/errors. Evidence: `.agent/runtime-evidence-v12.21-web.json`.

## v12.20 diagnostic assertions and memory-pressure evidence (2026-07-17)

- Diagnostic JSON now contains six content-free reliability assertions covering
  exact manifests, checkpoint prefix/bounds, retained audio for resumable
  states, completed transcript/summary outcomes, and nonterminal processing
  states. Five focused tests cover valid state, sparse corruption, silent
  checkpoints, content exclusion, and legacy statusless records.
- iOS memory warnings and Android `onTrimMemory` levels now reach the native
  recorder adapter. Session, route/interruption, committed bytes/duration,
  free-space, retries, memory pressure, and terminal outcomes are logged without
  meeting content; a focused adapter test proves memory pressure does not stop
  capture.
- 65/65 tests, production build/lint, both Capacitor syncs, exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. APK: 8,418,894 bytes,
  SHA-256 `0867048bb6e158e39bbfb8e600e24185842181a179908a012863702f3bf15c91`.
  Evidence: `.agent/build-evidence-v12.20.json`.
- The v12.20 web UI passed all eight integrity steps at 7:18:39 AM local with
  no browser warning/error logs and zero History artifacts. Evidence:
  `.agent/runtime-evidence-v12.20-web.json`. Physical memory-pressure and
  long-duration qualification remain unproven.

## v12.19 late native-start and cleanup boundaries (2026-07-17)

- A canceled native recorder startup now rejects/detaches late listener results;
  if platform start later resolves active, it is stopped again before the stale
  result can be accepted. Two focused race tests cover both orderings.
- Native speech cancellation, recorder flush/listener cleanup, import-listener
  attach/remove, and native/browser free-space probes now have terminal limits.
  Uncertain speech cleanup preserves checkpoints and requires reopen before Retry.
- 59/59 tests, production build/lint, both Capacitor syncs, exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. APK: 8,735,394 bytes,
  SHA-256 `141cc6e82ca43f2cf49aa05bc3a03f13ca29e11afc07029959e3005e02332cad`.
  Evidence: `.agent/build-evidence-v12.19.json`.
- The v12.19 production web UI passed all eight integrity steps with no browser
  warning/error logs and zero History artifacts after cleanup. Evidence:
  `.agent/runtime-evidence-v12.19-web.json`. Physical bridge-stall injection
  remains unproven.

## v12.18 terminal model preparation (2026-07-17)

- Whisper, Gemma, and MiniLM preparation now use correlated generation IDs,
  inactivity timeouts, and absolute deadlines. Timeout/error/crash replaces the
  worker, rejects dependent requests, persists a visible inline error, and
  exposes Retry; late replies from an older attempt remain stale.
- Saved audio/checkpoints, deterministic summaries, and full-text search remain
  authoritative fallbacks. Cached Whisper re-warm continues bounded automatic
  transcript resume until ready or terminal failure.
- Native speech and Android decoder launch probes end within five seconds; a
  stalled speech probe starts Whisper fallback preparation rather than blocking it.
- 57/57 tests, production build/lint, both Capacitor syncs, exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. APK: 8,734,716 bytes,
  SHA-256 `cda114ad1a40387423d6553e7ab4f2c0ea713a6f77bd4571aef3919bc789c305`.
  Evidence: `.agent/build-evidence-v12.18.json`.
- The v12.18 production web UI passed all eight integrity steps with no browser
  warning/error logs and zero History artifacts after cleanup. A real cached
  Gemma network-start failure ended visibly with an inline Retry control while
  private-summary/full-text fallbacks remained available. Evidence:
  `.agent/runtime-evidence-v12.18-web.json`. Physical timeout injection remains
  unproven.

## v12.17 semantic index integrity (2026-07-17)

- Exact vector count, finite values, and a single embedding dimension are now
  required across all semantic-index batches before IndexedDB replacement.
  Corrupt stored vector sets are treated as unindexed/rebuildable and skipped
  by semantic ranking.
- An embedding-worker crash rejects pending work, resets model state, replaces
  the worker, and surfaces a visible retry notice while lexical search remains
  available.
- 54/54 tests, production build/lint, both Capacitor syncs, exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. APK: 8,659,282 bytes,
  SHA-256 `a8444af147d5846ea79523c74a75116452d005736d2c11e172f400d976a817d8`.
  Evidence: `.agent/build-evidence-v12.17.json`.
- The v12.17 production web UI passed all eight integrity steps with no warning/
  error logs and zero History artifacts after cleanup. Evidence:
  `.agent/runtime-evidence-v12.17-web.json`. Pending-request rejection and
  corrupt-response validation are automated; worker replacement is source/build
  verified, and physical mobile search qualification remains open.

## v12.16 bounded recording startup (2026-07-17)

- Microphone acquisition and native/web recorder startup have visible 30-second
  deadlines. A late browser permission stream is immediately stopped.
- Startup timeout performs bounded recorder stop plus authoritative storage
  scan. Verified audio is recovered; confirmed-empty shells are removed only
  after both operations succeed; uncertain evidence retains a visible recovery
  shell and deletes nothing. Optional haptics never delay capture/finalization.
- 51/51 tests, production build/lint, both Capacitor syncs, exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. APK: 8,658,700 bytes,
  SHA-256 `b85f4595f6935a717b832ce23515003396dbda141eec6bcd655ae7c1d77249e4`.
  Evidence: `.agent/build-evidence-v12.16.json`.
- The v12.16 production web UI passed all eight integrity steps with no warning/
  error logs and zero History artifacts after cleanup. Evidence:
  `.agent/runtime-evidence-v12.16-web.json`. Physical startup-timeout injection
  remains unproven.

## v12.15 secondary handoff completeness (2026-07-17)

- GitHub, Calendar, and Email now hydrate completed transcripts and repair
  missing summaries before generating their handoff. Interrupted partial text
  is explicitly blocked from every export.
- Long email content is never sliced; oversized mail links visibly fall back to
  the complete meeting share. GitHub header/body stalls terminate after 30
  seconds with a retryable error.
- 46/46 tests, production build/lint, both Capacitor syncs, exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. APK: 8,658,086 bytes,
  SHA-256 `d201e9e9c46f13c29469b5deadf945ab2a40f2fb1d514a7187b988604bea5e02`.
  Evidence: `.agent/build-evidence-v12.15.json`.
- The v12.15 production web UI passed all eight integrity steps with no warning/
  error logs and zero History artifacts after cleanup. Evidence:
  `.agent/runtime-evidence-v12.15-web.json`. Physical destination receipt is
  still unproven.

## v12.14 backup and missing-summary export repair (2026-07-17)

- Duplicate-ID backup restore now fills a missing transcript archive without
  replacing a valid current transcript, then routes the recovered transcript
  through exact archive write/readback before compact metadata is saved.
- Transcript/Markdown/PDF export now repairs and persists a deterministic
  summary when the complete transcript exists but summary fields are blank.
- 43/43 tests, production build/lint, both Capacitor syncs, exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. APK: 8,657,720 bytes,
  SHA-256 `fa2187092d8b854456f58360320ee4ea31a11c4ba036616d25b35af3c7103bf6`.
  Evidence: `.agent/build-evidence-v12.14.json`. Physical backup restore and
  destination-app Markdown/PDF receipt remain unproven.
- The v12.14 production web UI passed all eight integrity steps with exact
  transcript/Markdown/PDF final-marker checks, no warning/error logs, and zero
  History artifacts after cleanup. Evidence:
  `.agent/runtime-evidence-v12.14-web.json`.

## v12.13 direct playback and loss-safe import completion (2026-07-17)

- Native segmented recordings and single-file multi-hour imports now play from
  a converted app-container URI. No complete protected audio file is copied as
  base64 into WebView memory. Missing URIs end in the existing visible Retry
  Audio state without an unsafe whole-file fallback.
- If a native import callback fails after an atomic file publish, protected
  storage is scanned before cleanup. Verified audio is retained as a playable,
  retryable meeting; a failed/uncertain scan deletes nothing.
- The deterministic whole-meeting summary is persisted immediately even when
  cloud refinement is enabled. Optional model input is bounded for long
  transcripts, and failure keeps the complete private result.
- 38/38 tests, production build/lint, both Capacitor syncs, exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. APK: 8,657,425 bytes,
  SHA-256 `aa6b4e3763696795a51a7f541c406aef42ce39f21a2382a4efa09dbf35bf9204`.
  Evidence: `.agent/build-evidence-v12.13.json`.
- The v12.13 browser UI then passed the updated eight-step integrity check. Its
  production playback resolver decoded the fixture, the exact transcript,
  summary/search markers, complete Markdown, 44-page PDF final marker, and
  cleanup all passed; browser warning/error logs were empty and History stayed
  at zero. Evidence: `.agent/runtime-evidence-v12.13-web.json`. Native direct-
  file playback remains a physical-device gate.
ADB currently reports no attached Android device.

## v12.12 verified production native exports (2026-07-14)

- Transcript, Markdown, PDF, and the integrity harness now use the same native
  cache-file verifier: write, exact readback, then URI resolution. Three fault
  tests prove truncated text/base64 payloads stop before URI resolution, with a
  visible nothing-shared error. Android transcript and Markdown export use the
  native share sheet. Destination-app receipt is still unproven.
- 32/32 TypeScript tests, production build/lint, both Capacitor syncs, the exact
  v12.12 unsigned iOS Simulator build, and Android 4/4 unit tests,
  `assembleDebug`, and `lintDebug` pass. The APK is 8,656,652 bytes with
  SHA-256 `df716d31730cbf9c3b785ab9b4bf46e8d15cc2d3960bde2bf6d60c2091166e04`.
  Evidence: `.agent/build-evidence-v12.12.json`.

## v12.11 Android cold-process recovery correction (2026-07-14)

- Recovery STOP now rehydrates the exact protected-file snapshot before a
  newly recreated service persists inactive state. Four focused JVM tests and
  the Android assemble/lint gates pass. This build has not yet received a new
  emulator or physical process-death run.

## v12.10 native Android saved-audio STT runtime (2026-07-14)

- Android 13+ native code uses one-minute MediaCodec decode plus a verified
  file-descriptor audio source for the on-device SpeechRecognizer. Exact intent
  support and the installed English model are checked before every start, with
  explicit cancel, cleanup, silence completion, and a three-minute deadline.
- The existing durable subcheckpoint contract is unchanged. Structural native
  failures disable only that engine and retain Whisper fallback; transient busy
  or timeout failures remain retryable without discarding completed work.
- An isolated fresh API 34 x86 emulator booted, installed the APK, cold-launched
  MeetingGhost, and registered NativeSTT. Runtime returned the explicit terminal
  state `available:false` / English model not installed, reported native
  MediaCodec available, and loaded the Whisper fallback worker. The app process
  remained alive with no AndroidRuntime crash.
- First-run onboarding and Studio rendered at 393dp with large labeled controls
  and persistent navigation. The emulator itself produced a System UI ANR under
  heavy host load; this was not a MeetingGhost ANR/crash and is not physical
  device qualification.
- The final installed APK passed all eight synthetic two-hour integrity steps:
  9,644 saved audio bytes recovered and decoded, 174,104 transcript characters
  restored exactly, summary and exact-search markers found, 174,821-character
  Markdown complete, and a 44-page/362,438-byte PDF containing the final marker.
  Android then read back the exact cache files used at the native share boundary
  and matched both byte-for-byte. The app process remained alive, the filtered
  integrity-run error log was empty, and all test artifacts were removed.
  Evidence: `.agent/device-evidence-v12.10-android-integrity.json`.
- Cold-process review then exposed an Android recovery race: a `STOP` delivered
  to a newly created service could overwrite its persisted meeting/manifest
  with empty in-memory fields. The service now restores its exact durable file
  snapshot before terminal persistence. Four focused JVM tests cover sparse
  committed files, all partial-name forms, byte totals, normalized failed IDs,
  next-index selection, duration preservation, and unsafe meeting IDs; Android
  unit test, assemble, and lint pass. Runtime process-death replay remains in
  the physical matrix because the reset API 34 AVD required 7.4 GB with only
  4.6 GB host space available.
- Remaining gate: prove actual native file recognition with microphone denied,
  cancel/retry, 30-minute/two-hour imports, memory, locked recording, playback,
  and receipt of Markdown/PDF shares in destination apps on lower-memory and
  flagship hardware. The app-controlled native share-file boundary is proven;
  the receiving app is not.
- Final v12.10 validation passes: 29/29 automated tests, web production build,
  lint, both Capacitor syncs, unsigned iOS Simulator Debug build, Android
  `assembleDebug`, and Android `lintDebug`.

## v12.9 native iOS import/transcription implementation (2026-07-14)

- The iOS picker now stream-copies security-scoped documents directly to an
  ignored partial in app-private storage with progress, a 100 MB floor,
  ten-minute deadline, fsync, exact byte verification, and atomic publish.
- Apple Speech now receives native one-minute CAF units and persists each
  completed result. Retry resumes at the first missing unit instead of
  restarting a two-hour imported file.
- 28/28 automated tests, web build/lint, and an unsigned dual-architecture iOS
  Simulator Debug build pass. Physical document-provider, SpeechAnalyzer,
  force-quit resume, memory, playback, and destination-export proof is pending.

## v12.8 native Android import/decode implementation (2026-07-14)

- Android’s document picker streams directly to a partial app-private file;
  copy progress, storage checks, a ten-minute deadline, fsync, byte verification,
  and atomic publish prevent a huge import Blob from entering the WebView.
- MediaExtractor/MediaCodec decodes one minute at a time to verified mono 16 kHz
  PCM. Whisper still performs inference in its worker, but Retry checkpoints
  every native range instead of decoding the original file again.
- 27/27 automated tests, web build/lint, Java compile, and Android assemble pass.
  The v12.8 browser bundle passed all eight integrity checks and left History
  empty. No Android device is connected. The API 34 x86 AVD launched but stayed
  `adb offline` through a bounded cold-boot/reconnect attempt, so actual codec/
  model memory, 30m/2h import, process-death resume, and destination share remain
  unproven.

## v12.7 native segmented capture implementation (2026-07-14)

- iOS AVAudioRecorder and Android foreground-service MediaRecorder now own the
  microphone and 15-second rotation independently of WebView execution.
- Both write an ignored partial file and publish `seg-n` only after recorder
  close, atomic rename, and byte verification. Existing playback/transcription
  reads the same app-private path and exact sparse manifest.
- Native progress, storage pressure, interruptions, errors, auto-stop, status,
  flush, and stop results feed the React recovery state. A background return
  reconciles missed terminal events; relaunch finalizes an Android orphan before
  enumerating saved files. Recording finalization times out visibly at 30s.
- Startup also scans exact native/IndexedDB manifests without relying on compact
  meeting metadata and rebuilds a visible Recovered Meeting shell for verified
  orphan audio.
- The synthetic reliability test explicitly bypasses production native capture
  with its generated stream and therefore remains microphone-free.
- 25/25 automated tests, TypeScript build, lint, iOS Simulator Debug compile,
  and Android `assembleDebug` pass. A clean installed v12.7 web bundle passed
  all eight integrity steps, including metadata-loss audio recovery, and left
  History at zero after cleanup. No physical recording was made in this
  environment, so lock/route/interruption/15m/60m/2h remain unproven.

## v12.6 bounded imported-audio transcription (2026-07-14)

- Web/Android Whisper splits decoded PCM into contiguous five-minute inference
  units. Each completed unit is persisted immediately; History shows the
  containing audio part and chunk position, and Retry starts at the first
  missing unit rather than redoing the whole imported file.
- Final assembly rejects a sparse/missing middle unit. Import persistence,
  saved-audio discovery, native path/read, playback loading, and native
  Markdown/PDF file preparation now have visible terminal timeouts.
- Automated coverage is 22/22, including a two-hour/24-chunk lossless range
  fixture and a stalled-operation timeout. This is source-level evidence only:
  the initial web/Android decode is still whole-file and 30-minute/two-hour
  imports have not passed a physical-device memory/resume/share matrix.
- Final assets sync to both native projects; unsigned iOS Simulator Debug and
  Android `assembleDebug` pass. A clean browser session shows the installed
  v12.6 build label and the seven-pass integrity result with no server-side
  browser warnings/errors.

## v12.5 full-chain intelligence integrity result (2026-07-14)

- A new Diagnostics check uses synthetic data only and exercises real audio
  persistence/decode, transcript storage/hydration, summary, search, Markdown,
  PDF, and cleanup without adding a meeting to History.
- Its first browser run failed honestly because repetitive content crowded
  middle/final coverage out of the deterministic summary. The summarizer was
  corrected to select distinct salient coverage across temporal thirds.
- The corrected run passed: 9,644-byte WAV decoded at 0.300s; 174,104 transcript
  characters hydrated byte-for-byte; required decision/action summary markers
  present; exact lexical source correct; 174,821-character Markdown complete;
  44-page/362,438-byte PDF final marker present; temporary artifacts removed.
- 20/20 automated tests pass. This is strong browser/storage/export evidence,
  but it does not prove a native share destination received the file or that a
  physical phone completed a real recorded conversation.
- Final v12.5 assets sync to both native projects; unsigned iOS Simulator Debug
  and Android `assembleDebug` builds pass.

## v12.4 intelligence terminal-state correction (2026-07-14)

- Model-unavailable transcription now exits Processing and remains visibly
  retryable; a short iOS recording performs a bounded native-engine re-probe.
- Retry/playback recover stale segment counts from manifests or disk.
- Literal transcript hits rank before semantic suggestions.
- Optional LLM refinement times out without replacing the complete private
  summary; native PDF export now shares a real complete PDF file.
- 19/19 tests, lint, production build, and a fresh History/Ask browser flow
  pass with no browser warnings/errors. Both native syncs, an unsigned iOS
  Simulator Debug build, and Android `assembleDebug` pass with the final v12.4
  bundle. Physical-device export/playback and kill/resume tests remain required.
- Current host/device discovery did not permit that run: `devicectl` still
  times out waiting for CoreDeviceService, `xctrace list devices` exited 139,
  and USB inspection shows no iPhone. Android `adb` was found at the SDK path
  and started successfully, but listed no connected devices. These are
  host/device proof blockers, not evidence that the app passed on hardware.

## v12.3 dependable meeting-intelligence correction (2026-07-14)

- Transcription/chat/summary/title worker replies are request-correlated; late
  timed-out results cannot resolve a newer operation or overwrite another meeting.
- Sparse checkpoints rewind and final assembly rejects any missing segment.
- Archived content hydrates before Ask; lexical results always supplement the
  optional semantic index and remain available after semantic failure.
- IndexedDB open/transactions have explicit timeouts and commit-aware writes.
- Playback read/decode failures are visible and retryable.
- Incomplete transcription blocks Markdown/PDF/share instead of exporting a
  blank transcript. Native shares remain file-based; PDFs include duration.
- 17/17 tests, production build, and lint pass. A real local browser loaded the
  app, navigated History/Ask/Models, exercised the empty lexical fallback, reset
  the busy state correctly, and reported zero console warnings/errors.
- `npx cap sync ios`, `npx cap sync android`, an unsigned iOS Simulator Debug
  build, and Android `assembleDebug` all pass with the final v12.3 assets.
  None of this browser/build evidence is physical-device proof.

## v12.1 background-recording correction (2026-07-12)

The physical 60-minute v12.0 run exposed a real failure, not a pass. It began
at 06:02:54 CDT, but when evidence was pulled at 10:45:59 CDT it still had
`running:true`, no terminal result, and its app process was no longer alive.
Only `seg-0` survived (834,342 bytes, finalized 06:03:50 CDT). This proves the
old `UIBackgroundModes` + WebView lifecycle-flush approach did not keep capture
alive when the phone locked/went offline, although save-first recovery worked.
Machine evidence: `.agent/device-evidence-v12-60min-stalled.json`.

v12.1 fixes the missing native lifecycle layer:

- iOS now activates an `AVAudioSession` in `.playAndRecord` mode for the full
  recording and supports Bluetooth HFP input.
- Android now runs an OS-visible foreground microphone service with a partial
  wake lock and persistent recording notification.
- Start fails closed if the native session cannot be established; the app does
  not imply that an unsafe background recording is active.
- Web build, lint, 12 tests, iOS Simulator build, and Android debug build pass.
  Export coverage verifies that an hours-long meeting share contains the
  `h:mm:ss` duration, summary, action items, and final transcript sentence
  without truncation.

Physical screen-lock and 60-/120-minute tests must be rerun on v12.5 before
claiming background or hours-scale device reliability.

## v12.2 accumulated-transcript storage correction

Completed transcripts now move to a dedicated IndexedDB v2 content store after
an exact write/read-back check; compact synchronous metadata remains available
for crash recovery. Reload hydrates transcript bodies for History, search, and
exports. If archival fails, text stays inline rather than being discarded.
The browser harness passed with 1,408,889 characters and reduced the compact
metadata record from 1,429,105 characters to 217 while restoring the transcript
exactly. Unit/build/lint gates now pass with 13 tests.
All transcript-bearing exports and backups also hydrate on demand, closing the
post-launch race where a user could otherwise export before background
hydration completed; missing content now stops visibly rather than truncating.
The final mobile readability pass further increases navigation/action labels,
status text, meeting titles, and button text while preserving 44–60px touch
targets. Static CSS constraints, web build, lint, and 13 tests pass. The final
assets were synced to iOS and Android, but a fresh signed native rebuild and
390pt physical visual pass after this CSS-only change remain pending.

## v12 automated/build evidence (2026-07-11; not physical-device proof)

- Accelerated two-hour-equivalent recorder test: 120 one-minute segment slots,
  with a simulated write failure at segment 57; all 119 verified files remain
  addressable and segment 58+ are not discarded.
- Stop-during-rotation waits for the pending `MediaRecorder.onstop` write.
- Concurrent stop/low-storage paths share one idempotent finalization.
- An ended microphone track auto-stops with a truthful reason instead of
  leaving a false recording state.
- Long punctuation-free transcripts produce bounded search excerpts and a
  bounded whole-meeting summary; embedding requests run in batches of 16.
- A synthetic two-hour transcript produces a paginated PDF (>20 pages).
- Web build/lint/tests pass; synced iOS Simulator and Android debug builds pass.
- Android `FreeDisk` bridge and `WAKE_LOCK` permission are compiled; physical
  Android low-storage and multi-hour tests are still required.

## v12 physical-device long-session result (2026-07-12)

**15-minute tier — PASS on physical iPhone 14 Pro, Release build:**

- Fresh run: `2026-07-12T10:46:04.105Z` → `2026-07-12T11:01:11.456Z`
- 900 seconds recorded; 15/15 one-minute segments durably saved
- 13,596,559 verified audio bytes
- Native Apple Speech transcription completed; terminal status `complete`
- Zero kills/relaunches; PID 1350 remained unchanged in every minute check
- Full record→save→transcribe wall time: 907,297 ms
- Machine evidence: `.agent/device-evidence-v12-15min.json`

The launch also exposed and fixed two self-test-only replacement bugs: stale
runs could overwrite cancellation after a normal cycle or kill-recovery cycle.
The harness now polls replacement once per second and safely finalizes the
active recording before a fresh run takes ownership.

Still unproven on the current build: physical 60-minute and two-hour tiers,
screen lock/background, calls/Siri, Bluetooth route changes, restart, and low
storage. Do not generalize the 15-minute pass to those scenarios.

## ★ Device-verified acceptance results (2026-07-11)

**25-cycle record→save→transcribe matrix — PHYSICAL iPhone 14 Pro, iOS 26.5,
Release build, native Apple Speech engine (run 1, hands-free via MG_SELFTEST):**

- startedAt 17:57:48Z → finishedAt 18:06:36Z (8.8 min)
- **25/25 cycles saved playable audio** (verified byte counts 257–274 KB per 20s cycle)
- **25/25 cycles auto-transcribed to `complete`** (acceptance requires ≥24/25)
- ~21.1s per cycle: 20s recording + ~1s native transcription
  (Whisper-WASM took 25–40s per 20s segment and crashed the WebView)
- Zero crashes across the entire run; app process alive throughout
- Evidence: `selftest-results.json` pulled from the device via devicectl
  (machine-generated metrics only)

**Run 2 (kill-recovery variant, `device-evidence-run2-killrecovery.json`):**
fresh run confirmed live (cycles 1–4 PASS) → **force-quit (SIGKILL) fired
mid-cycle-5** via devicectl → phone relaunched → run **resumed automatically
from its persisted cursor, kills=1 counted**. Killed cycle 5 was seconds into
its recording (nothing flushed yet) and landed in `recovery_required` with an
honest zero-bytes diagnosis — the documented ≤60s in-flight window, surfaced,
not silently lost. **Cycles 6–17 all PASS after the resume** (16/17 non-killed
cycles pass; run continues whenever the app is next foregrounded — suspension
mid-run checkpoints and resumes by design).

**Acceptance mapping (device-verified):**
- "All 25 two-minute tests save playable audio" → run 1: 25/25 ✓
- "At least 24/25 auto-transcribe" → run 1: 25/25 ✓
- "Force quit during recording/transcription → recover" → run 2: kill mid-run,
  auto-resume, kills counted, per-cycle states honest ✓
- "Stopped recordings appear in History immediately / no endless state after
  relaunch / audio playable when transcription fails" → owner screenshot +
  runs 1–2 state reconstruction ✓
- "Memory does not continuously grow" → inferred only (app survived 25+17
  consecutive cycles without jetsam); Xcode instrument numbers still pending.
- Real-speech accuracy, 15/60/120-min recordings, Bluetooth, calls, restart,
  low storage, permission-denial → still owner-run checklist items.

---

# Historical: v10.0 report

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
| Install + launch Release build on iPhone 14 Pro (iOS 26.5) | pass (devicectl install + launch, process confirmed) | **device-verified** |
| Recording on device → segmented save (81s → 2 segments, dur 01:21) | pass (owner screenshot 2026-07-11 07:38) | **device-verified** |
| Recording survives a REAL transcription crash — audio playable, "interrupted — resumable" chip, Retry button (the core zero-loss criterion) | pass (07:34 recording, 11s, player functional after crash) | **device-verified** |
| Live per-segment progress on device ("Transcribing 2/2 — 100%") | pass (owner screenshot) | **device-verified** |
| Segmented player with part label (1/2) on device | pass (owner screenshot) | **device-verified** |

## Bugs found on device (fixed in v10.1)

1. **App exits to home screen when transcription fails** — WKWebView process
   crash during Whisper inference (suspected OOM). The save-first architecture
   contained it (audio + state intact, resumable). v10.1 mitigations: 20s
   inference windows (lower peak memory), single-thread WASM pinned,
   transferable audio buffers, auto-resume on relaunch with a crash-safe
   attempt counter (max 2 automatic attempts — a deterministic crash cannot
   loop). Root cause needs the on-device diagnostics export.
2. **Text overflow with Display Zoom / large Dynamic Type** — headings wrapped
   vertically, status chips clipped off-screen. v10.1: headings scale down at
   ≤480/360pt, meta rows wrap, chips wrap instead of clip.

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

1. Native capture targets a maximum 15-second uncommitted tail and ignores a
   killed `.partial` file. True force-quit behavior must be confirmed (test 11).
2. v12.7 moves capture itself into AVAudioRecorder/Android foreground service
   after v12.0 WebView capture failed under lock/offline. It compiles, but
   lock/background duration still needs device proof.
3. Every platform has a deterministic local structured summary; WebGPU or an
   optional BYO Claude key can refine it but are not required.
4. Imported files are stored as a single segment and initially decoded in one
   piece. v12.6+ bounds subsequent web/Android inference into five-minute
   checkpointed units, but 30-minute/two-hour import memory and native share
   remain untested on device. Recordings are always ≤60-second pieces.
5. Memory-growth across repeated recordings (test 20) requires Xcode
   instrumentation on the device; not measurable in preview.
