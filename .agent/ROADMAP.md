# MeetingGhost Gold — Reliability Roadmap

**Updated:** 2026-07-18 · **Current source:** v12.27 · **Release state:** not yet
qualified for locked, hours-long mobile recording or real-meeting summary quality.

## ✅ Completed (v1.0 - v9.0)
- **v1.0 (Init):** Setup Vite + React + Capacitor project.
- **v2.0 (Native Polish):** UI/UX foundations, brushed gold aesthetic, audio waveform visualization.
- **v3.0 (On-Device AI Workers):** Web Worker architecture for Whisper (STT) and TinyLlama (Summarization).
- **v4.0 (UX & Pro Audio):** iOS `100dvh` fixes, Floating Action Area, First-Time Onboarding UI, Audio File Import, Auto-Titling, PDF/Markdown Exports, and History Search.
- **v4.1 (Reliability):** Workers re-warm automatically after reload (models cached but never re-initialized was a hard bug), in-flight init queuing in both workers, aggregated Whisper download progress, WebGPU capability detection surfaced in the Models tab, StrictMode double-save fix, stale-closure fix in `process()`.

- **v5.0 (Organization & Search):** Folders, keyword highlighting, full JSON backup export/merge-import, visualizer themes (bars/wave/circle), typed storage module.
- **v6.0 (Meeting Intelligence):** Structured summaries (key points/decisions/action items), summary templates, persistent action-item checklists, optional BYO-key Claude tier with Settings tab.
- **v7.0 (Semantic Search & Chat):** MiniLM embedding worker, IndexedDB vector store, auto-indexing, "Ask Your Meetings" tab with AI answers + source excerpts.
- **v8.0 (Integrations & Sharing):** GitHub Issues export (one issue per meeting with task-list), .ics calendar follow-ups, email drafts, structured PDF/MD exports.
- **v9.0 (Playback & Polish):** Recordings persisted to IndexedDB with 0.5–2.5x playback player, README + docs refresh.

## ✅ Completed in source/build validation (v10.0–v12.27)

- **v10 save-first recording:** verified one-minute segments, recovery state
  machine, resumable checkpointed transcription, playback, diagnostics, and
  native free-space checks.
- **v11 iOS transcription:** Apple Speech runs outside WKWebView; iOS no longer
  depends on memory-heavy Whisper-WASM inference.
- **v12 resilience:** exact segment manifests, idempotent stop, worker failure
  handling, deterministic summary/search fallbacks, bounded long-meeting work,
  complete Markdown/PDF exports, Android native session/free-disk bridges.
- **v12.2 storage and usability:** verified IndexedDB transcript archival and
  hydration, larger mobile text/icons, persistent labeled navigation, and
  44–60px core touch targets.
- **v12.3 dependable intelligence:** request-correlated worker results,
  sparse-checkpoint rewind, hydration-first search with lexical fallback,
  bounded/commit-aware IndexedDB, explicit playback failures, and complete-only
  file/PDF exports.
- **v12.4 terminal-state/export completion:** unavailable engines exit the
  spinner into Retry, repaired manifests drive playback/resume, literal search
  wins over semantic suggestions, optional summary refinements time out, and
  native PDF export shares an actual complete file.
- **v12.5 full-chain integrity:** an on-device synthetic two-hour check verifies
  audio durability/decode through transcript hydration, temporal summary,
  search, Markdown/PDF final markers, and cleanup; it exposed and drove a fix
  for repetitive summaries that omitted middle/final meeting coverage.
- **v12.6 bounded import inference:** web/Android Whisper processes decoded
  imports in contiguous five-minute units, durably checkpoints each unit, and
  resumes from the first missing unit. Import persistence, saved-audio lookup,
  playback reads, and native export-file preparation now time out visibly.
- **v12.7 native segmented capture:** iOS `AVAudioRecorder` and an Android
  foreground-service `MediaRecorder` now own capture outside the WebView,
  commit 15-second `.partial` files only after close/byte verification, expose
  interruption/storage/terminal events, and reconcile an orphaned native
  session on relaunch. Exact audio storage is also enumerated independently of
  compact meeting metadata so verified orphan audio receives a visible recovery
  shell. The installed web bundle passes all eight full-chain integrity steps;
  both native projects compile; physical proof is pending.
- **v12.8 bounded native Android import/decode:** Android’s document picker
  streams the selected file directly into an fsynced, byte-verified, atomically
  published segment with visible copy/finalize progress and a ten-minute
  terminal deadline. `MediaExtractor`/`MediaCodec` reads that private file in
  one-minute ranges, downmixes/resamples to verified 16 kHz PCM, and preserves
  the existing per-range checkpoint/retry contract. Whisper inference remains
  WebView-owned; physical Android import/transcription proof is pending.
- **v12.9 bounded native iOS import/transcription:** iOS’s document picker now
  stream-copies directly into app-private storage with progress, free-space
  enforcement, fsync, byte verification, atomic publish, and a ten-minute
  deadline. Apple Speech inspects the private file and transcribes contiguous
  one-minute native CAF units, durably checkpointing every completed unit so a
  two-hour import can resume without restarting. Physical iOS import and
  SpeechAnalyzer proof is pending.
- **v12.10 bounded native Android transcription:** Android 13+ now decodes each
  exact saved-audio minute natively and supplies PCM16 through a file-descriptor
  pipe to the on-device SpeechRecognizer. The app checks support for that exact
  file-audio intent before every request, enforces a three-minute terminal
  deadline, exposes cancel, and retains durable `tSub*` checkpoints. If a
  device lacks the service/model/file-audio capability, the probe ends visibly
  and the bounded Whisper path remains available. An isolated API 34 emulator
  launched the app and returned a clean model-unavailable result. The final APK
  then passed all eight two-hour-equivalent intelligence steps, including exact
  native Markdown/PDF cache-file readback, empty error log, live process, and
  complete synthetic cleanup. Physical transcription accuracy, memory,
  destination receipt, and long-file proof remain pending.
- **v12.11 Android cold-recovery correction:** recovery STOP now reconstructs
  the exact protected-file snapshot before terminal persistence, preventing a
  newly recreated service from replacing the persisted meeting/manifest with
  empty in-memory fields. Four JVM fault-injection tests cover sparse committed
  segments, all partial-tail forms, bytes/duration/failed IDs/next index, and
  unsafe IDs; physical process-death replay remains pending.
- **v12.12 verified native exports:** the production transcript, Markdown, PDF,
  and integrity paths share one cache-write/readback verifier. Exact content is
  required before URI resolution or share-sheet presentation; injected
  truncation tests prove mismatched files stop without being shared. Android
  transcript and Markdown export now use the native share sheet. All 32 tests,
  web build/lint, both native asset syncs, the exact unsigned iOS Simulator
  build, and Android 4/4 unit/assemble/lint pass. Physical install and receiving-
  app share proof remain in the qualification matrix.
- **v12.13 hours-scale consumption hardening:** native recordings and imports
  play from direct protected-file URLs without a whole-file base64 WebView copy;
  failed import callbacks preserve verified published audio before cleanup; and
  cloud-enabled summaries persist the deterministic whole-meeting result before
  bounded optional refinement. All 38 tests and exact native build gates pass.
- **v12.14 restored-content/export repair:** duplicate-ID backup merge repairs
  a missing transcript archive without replacing a valid current transcript;
  complete-transcript exports repair and persist a missing deterministic
  summary before generation. All 43 tests and exact native build gates pass.
- **v12.15 complete secondary handoffs:** GitHub, Calendar, Email, backup, and
  startup hydration now use complete transcript/summary state; interrupted
  partial text is blocked from export, email never slices content silently, and
  GitHub stalls terminate visibly. All 46 tests, exact native build gates, and
  the eight-step production web runtime check pass.
- **v12.16 bounded recording startup:** microphone acquisition and recorder
  startup terminate visibly; late permission streams close; startup timeout
  reconciles stop/storage evidence without deleting uncertain audio; and
  optional haptics cannot block capture/finalization. All 51 tests, native build
  gates, and the eight-step production web runtime check pass.
- **v12.17 semantic index integrity:** embedding batches must be exact, finite,
  and dimensionally consistent before atomic replacement; corrupt stored vector
  sets are rebuildable instead of searchable; worker crashes reject all pending
  work, reset model state, install a replacement, and preserve full-text search.
  All 54 tests, native build gates, and the eight-step production web runtime
  check pass.
- **v12.18 terminal model preparation:** Whisper, Gemma, and MiniLM initialization
  now has correlated generations, inactivity and absolute deadlines, stale-reply
  rejection, visible persisted Retry states, and clean-worker replacement.
  Saved audio, deterministic summaries, and full-text search remain available;
  cached Whisper re-warm stays connected to bounded resume. Native speech and
  decoder capability probes now end within five seconds. All 57 tests, native
  build gates, and the eight-step production web runtime check pass.
- **v12.19 late native-start/cleanup terminality:** recorder cancellation now
  spans listener registration and platform start; late listeners detach and a
  late active start is stopped again. Native speech cancellation, recorder
  flush/listener cleanup, import-listener lifecycle, and free-space probes are
  bounded so cleanup/telemetry cannot strand capture or transcription state.
  All 59 tests, native build gates, and the eight-step web runtime check pass.
- **v12.20 content-free release evidence:** diagnostic exports now assert exact
  manifests, durable checkpoint prefixes/bounds, retained audio for resumable
  states, completed transcript/summary outcomes, and nonterminal states without
  meeting content. iOS memory warnings and Android `onTrimMemory` levels join
  session/route/finalized-size/free-space/retry/terminal telemetry, and memory
  pressure does not stop healthy native capture. All 65 tests, native build
  gates, and the eight-step web runtime check pass.
- **v12.21 durable transcript integrity:** completed transcripts now retain
  outcome, character/UTF-8 byte counts, and a versioned whole-body fingerprint.
  Hydration blocks missing, truncated, and same-length altered archives before
  search/summary/index/backup/export; silence is explicit; legacy bodies migrate
  safely; backup repair rearchives before compaction. All 69 tests, native build
  gates, the 1,408,889-character browser storage harness, and the eight-step web
  runtime check pass.
- **v12.22 transcript-bound semantic indexes:** versioned IndexedDB envelopes
  bind every vector set to the exact transcript fingerprint, chunk sequence,
  and MiniLM embedding contract. Same-ID repairs, legacy/corrupt records, and
  schema changes are excluded from Ask and visibly rebuildable; hydrated
  lexical search stays available. Diagnostics add content-free freshness
  counts. All 73 tests, native build gates, the real IndexedDB vector harness,
  large-transcript storage harness, and eight-step web runtime check pass.
- **v12.23 scale-bounded semantic jobs:** freshness/count/diagnostics use one
  bulk IndexedDB transaction at any meeting count; whole-library and automatic
  indexing have a 15-minute hard boundary; manual jobs expose meeting/chunk
  progress, Cancel, retained verified commits, and Index Remaining Meetings.
  Only transcribed meetings count toward completion. All 74 tests, including a
  500-meeting transaction regression, native build gates, real IndexedDB
  harness, large archive round-trip, and eight-step web runtime check pass.
- **v12.24 lazy verified transcript library:** launch and History keep archived
  bodies out of WebView memory; History search, Ask, and whole-library indexing
  verify one transcript at a time; View/Hide loads and releases a single body.
  A 500-archive test proves one concurrent read, missing archives fail closed,
  and all 76 tests, native build gates, rendered lazy-library workflow, large
  archive round-trip, and eight-step intelligence check pass.
- **v12.25 bounded library/backup jobs:** History and Ask expose meeting-count
  progress and stop at five minutes; hydration, migration, and restore archive
  sequentially; backup work exposes progress, Cancel, a 15-minute boundary, and
  loss-safe Retry. All 79 tests, native build gates, a rendered 400-meeting
  search/Ask/cancel/retry workflow, large archive round-trip, and eight-stage
  integrity check pass.
- **v12.26 visible recovery and accessible flow:** destructive meeting deletion
  retains metadata until every artifact deletion succeeds; clipboard,
  diagnostics, and integrity work terminate visibly; first launch never starts
  optional model downloads; external fonts/starter CSS are removed; focus,
  reduced motion, forced colors, 48px coarse targets, and modal/navigation/form/
  progress/live semantics are explicit. All 87 tests, web build/lint, native
  sync/build gates, rendered 390px workflow, diagnostics export, and the
  eight-stage integrity check pass without browser warnings/errors.
- **v12.27 grounded summary evaluation:** the optional local worker now loads
  actual Gemma 3 1B, long meetings use bounded chronological evidence, model
  decisions/tasks are grounded behind conservative deterministic extraction,
  and three realistic fixtures score the deterministic/Gemma/hybrid paths. The
  hybrid leads at 88.9/100, but the 14,522-word phone meeting still fails the
  qualitative release bar; stronger long-meeting synthesis remains P0.

## Phase 0 — real-meeting intelligence quality (P0)

1. Build a staged long-meeting summarizer that extracts topic/decision/action
   candidates per bounded chunk, checkpoints every chunk, and synthesizes only
   grounded candidates without holding the full transcript or model context.
2. Expand the gold set to at least 30 realistic meetings, including noisy ASR,
   no-task conversations, overlapping speakers, corrections, and 30/60/120
   minute cases. Require blinded human usefulness and factuality review in
   addition to lexical fixture scores.
3. Qualify the winning local model/pipeline on target iPhone and Android tiers
   for latency, peak memory, thermal/battery behavior, cancellation, restart,
   and resumability. Offer the optional BYO-cloud path when local hardware
   cannot meet the published quality/performance floor.

## Phase 1 — decisive native-capture qualification (P0)

1. Install the v12.26 native recorder build on physical iOS and Android devices.
2. Verify every 15-second committed file is playable and that a killed
   `.partial` tail never enters the recovery manifest.
3. Pass physical screen lock and 10× background/foreground tests first.
4. Pass 15-, 60-, and 120-minute tests plus calls/Siri, Bluetooth, restart,
   low storage, permission denial, force-quit recovery, playback, and memory.

## Phase 2 — qualify native Android transcription (P0)

Qualify the v12.26 support-checked file-audio engine on a lower-memory Android
device and a current flagship, including installed/missing language assets,
airplane mode, cancellation, process death, 30-minute/two-hour imports, and
proof that saved audio—not the microphone—is transcribed. Decide from those
results whether the unsupported-device Whisper fallback is sufficient or a
bundled whisper.cpp/sherpa-onnx model is required. Apple Speech remains the iOS
native path.

## Phase 3 — release hardening (P1)

- Physically qualify v12.26 native streamed import/direct playback, recovery,
  and one-minute transcription
  units with 30-minute/two-hour files on both mobile platforms. Web remains a
  browser-controlled compatibility path.
- Add nightly physical-device soak tests and fault injection for write failure,
  process death, route changes, full disk, and interrupted transcription.
- Complete VoiceOver/TalkBack, largest Dynamic Type/font scaling, Display Zoom,
  and small-screen QA using the v12.26 accessibility contract as the baseline.
- Verify Markdown/PDF/share/backup workflows in real target applications.
- Publish supported device/OS limits and privacy disclosures from measured data.

## After reliability gates

- Speaker diarization and custom vocabulary.
- Live transcription preview and translation.
- Encrypted local/P2P sync and platform lock-screen controls.
- Optional opt-in cloud transcription only if the product accepts the privacy,
  network, and per-minute cost tradeoff.

Architecture choices and tradeoffs are recorded in
`.agent/RELIABILITY_OPTIONS.md`.
