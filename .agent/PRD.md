# Product Requirements Document (PRD)
**Project:** MeetingGhost Gold
**Vision:** A premium, hyper-secure meeting transcription and summarization hub that runs 100% locally on-device. No cloud APIs, no subscriptions, total privacy.
**Current baseline:** v12.25 (2026-07-17). Optional BYO-key cloud refinement
exists, but every core recording, transcript, summary, search, playback, and
export path must remain useful without it.

## Core Value Proposition
- **Total Privacy:** Audio is processed directly on the user's hardware.
- **Ultra-Light Initial Install:** The core app is ~3MB. Heavy AI models are downloaded post-installation as needed.
- **Premium Aesthetic:** Designed with a brushed gold and obsidian black theme, targeting a luxurious, professional user experience (similar to premium fintech apps).

## Target Platforms
1. **iOS / Android (Capacitor Native):** Primary target. The UI must accommodate native constraints (e.g., `100dvh` for iOS Safari bottom bars, safe-area-insets).
2. **PWA (Web):** Full offline functionality in modern web browsers using WebAssembly and WebGPU.

## Key Features (Implemented)
- **Local Voice-to-Text:** Native Apple Speech on iOS; support-checked native
  on-device saved-audio recognition on Android 13+ where an English model is
  installed; Whisper-WASM on web and as an explicit unsupported-Android
  fallback. Production Android still requires physical device qualification.
- **Local Summarization:** Deterministic structured summary on every platform;
  optional WebLLM or BYO-key model refinement where supported.
- **Auto-Titling:** LLM automatically generates concise meeting titles.
- **Audio File Import:** Users can import existing `.wav`, `.mp3`, or `.m4a`
  files. iOS and Android stream the document directly to app-private storage;
  Apple Speech and Android MediaCodec/on-device SpeechRecognizer consume
  bounded one-minute native units. Both mobile implementations still require
  physical qualification.
- **Exporting Options:** PDF, Markdown (.md), and standard native sharing capabilities.
- **History Management:** Real-time title/transcript search, optional semantic
  search, compact recovery metadata in `localStorage`, and audio/transcript/
  vector content in IndexedDB or native app storage.

## Reliability and acceptance requirements

- Record continuously for two hours with the device screen locked, with no
  missing audible intervals and no dependence on the WebView remaining active.
- Microphone permission and recorder startup must have visible terminal
  deadlines. A late browser permission success must close its stream, optional
  haptics must never delay capture/finalization, and a timed-out recorder start
  may delete its shell only after both stop and storage scans prove no audio.
- A native recorder start that resolves after the startup deadline/cancellation
  must be stopped again before its result is accepted; a late listener must be
  detached and must never authorize invisible capture. Native speech cancellation,
  import-listener lifecycle, recorder flush/listener cleanup, and free-space
  probes require bounded terminal behavior. Uncertain native speech cleanup must
  preserve checkpoints and require a safe reopen rather than allowing overlap.
- Persist short independently playable native audio segments as capture occurs;
  a crash must not corrupt already finalized segments. Target worst-case
  unfinalized tail loss is ≤15 seconds. v12.16 implements this with atomic
  `.partial` to completed-file commits; physical qualification remains required.
- Transcription must operate only on saved audio, one bounded segment at a
  time, checkpoint after every segment or bounded import inference unit, and
  resume after process death without skipping a missing middle checkpoint.
- A completed meeting must remain searchable and exportable after app restart,
  device restart, and content hydration. Missing content must fail visibly,
  never produce a silently truncated export.
- App launch and History rendering must not hydrate or render every archived
  transcript. History search, Ask, and whole-library indexing must verify
  archives sequentially with bounded concurrency; only the current meeting and
  bounded top results may retain transcript bodies. Users must be able to load
  one complete transcript on demand and release it again without affecting the
  durable archive.
- Whole-library search, Ask, backup, restore, legacy migration, and indexing
  must report completed/total progress, use bounded sequential archive access,
  and have an absolute terminal deadline. Cancel must preserve every verified
  archive and every not-yet-archived inline body so Retry can resume safely.
- Every completed text transcript must retain expected character/UTF-8 byte
  counts plus a versioned whole-body fingerprint. Hydration must reject a
  missing, shortened, or same-length altered archive before search, summary,
  indexing, backup, or export. No-speech must be an explicit verified outcome,
  never an inference from absent text. Legacy archives may migrate only after
  their complete body is read successfully.
- Restoring a backup over an existing compact meeting must recover missing
  transcript content for the same meeting ID, while a verified current archive
  remains authoritative. A complete transcript with a missing summary must be
  deterministically summarized and persisted before Markdown/PDF sharing.
- Summary and lexical cross-conversation search must work without WebGPU,
  downloaded LLMs, a cloud key, or network access.
- Semantic indexing must accept only an exact, finite embedding batch with one
  consistent dimension. A partial/corrupt reply must not replace a valid
  index; corrupt stored indexes must be treated as unindexed and rebuildable.
  Each persisted index must be bound to the exact current transcript integrity,
  derived chunk text, and embedding model/pooling/normalization contract. A
  same-ID transcript repair, legacy envelope, or schema change must be excluded
  from Ask and surfaced as rebuildable while complete lexical search continues.
  Freshness checks must use a bounded number of storage transactions independent
  of meeting count. Whole-library indexing requires visible meeting/chunk
  progress, a hard job deadline, Cancel, and restart from fully verified
  per-meeting commits; no-speech or untranscribed recordings must not inflate
  the completion denominator.
  An embedding-worker crash must end pending work visibly, replace the worker,
  and leave lexical search immediately available.
- Whisper, optional summary, and semantic-model preparation must have both an
  inactivity timeout and an absolute deadline. Timeout/error must terminate the
  old worker, ignore its late generation replies, persist a visible Retry state,
  and keep saved audio, deterministic summaries, and lexical search usable. A
  stalled native speech capability probe must fall through to bounded Whisper
  preparation rather than blocking it indefinitely.
- Native playback of a multi-hour imported file must stream from protected
  storage; it must not duplicate the complete recording as base64 in WebView
  memory. If an import callback fails after atomic publication, verified audio
  must be recovered before any cleanup is allowed.
- Native share must hand another app a complete Markdown file; PDF and backup
  exports must include the complete hydrated transcript.
- GitHub, Calendar, and Email handoffs must hydrate the current transcript and
  restore the complete private summary before use. Partial transcription state
  must block every handoff. Network integrations require a visible terminal
  timeout, and email drafts must never silently slice summary/action content.
- Release qualification requires the physical iOS and Android matrix in
  `.agent/IPHONE_TEST_PROTOCOL.md` / `.agent/TASKS.md`; a build, simulator, or
  accelerated test is supporting evidence, not a substitute.
- Release diagnostics must assert exact manifests/checkpoints, retained audio,
  completed transcript/summary outcomes, and nonterminal states while excluding
  titles and all meeting content. Native session state, interruptions/routes,
  finalized byte/duration metrics, retries, memory pressure, free-space results,
  and terminal outcomes must be available for physical qualification.

## UX / UI Principles
- **Aesthetic:** Dark mode only. `var(--bg-void)` (#020304) base with `var(--gold-gradient)` accents. 
- **Frameworks:** No Tailwind. Pure custom CSS (`App.css`) for maximum flexibility and adherence to the premium metal aesthetic.
- **Layout:** The main "Record" button must *always* be visible. Use a floating action area pinned to the bottom of the screen.
- **Readability:** Core touch targets are at least 44×44pt/dp; mobile inputs are
  at least 16px; content/status text is at least 15px; navigation/action labels
  are at least 12px; primary icons are 19–22px and paired with text when their
  meaning is not universal.
- **Flow:** First launch explains Record → Save/Transcribe → Review → Share in
  plain language. Optional models and integrations cannot block basic use.

## AI Model Constraints
- **Resource Management:** Loading 250MB+ models in a mobile Safari tab requires careful memory management. Use Web Workers exclusively to prevent main thread freezing.
- **Graceful Degradation:** If WebGPU is unavailable (e.g., older iOS), summarization must fail gracefully without breaking the core transcription engine.
- **Native boundary:** Long-running mobile microphone capture and supported
  Android native inference must not rely on WKWebView/Android WebView process
  survival. Unsupported Android devices may use the clearly surfaced bounded
  Whisper compatibility path until a bundled native model is adopted.
