# Current Architectural State
**Last Updated:** MeetingGhost Gold v12.27 (2026-07-18)

## Release verdict

**Not yet qualified for dependable hours-long mobile recording.** The latest
source has strong save-first recovery, transcript persistence, export, summary,
search, and touch/readability improvements. A physical iPhone passed a
continuous 15-minute Release run, but an earlier 60-minute locked/offline run
failed after its first WebView-owned segment. v12.26 retains the native
replacement for that failed layer with native iOS/Android capture and 15-second
atomic commits, but it has not yet
been installed and rerun through the lock, 60-minute, and two-hour gates. No
current physical Android evidence exists. An initial 2026-07-18 device audit
timed out waiting for CoreDeviceService, but a later connection succeeded to
David’s iPhone XIV and confirmed the installed MeetingGhost container plus the
private 90-minute meeting artifacts. v12.27 was not installed over that copy
because a complete container backup could not be made safely. `adb` is still
absent, so no current Android runtime proof exists.

Summary quality is also a release blocker. v12.27 corrects the mislabeled local
worker from TinyLlama to actual Gemma 3 1B, adds conservative task/decision
extraction, chronological long-meeting evidence, grounded refinement, and three
realistic scored fixtures. The guarded hybrid averaged 88.9/100 versus 86.1
for deterministic extraction and 46.7 for Gemma alone. However, a private
14,522-word meeting recovered from the installed phone app still produced vague
key points and a poor title. It correctly produced no unsupported decisions or
tasks, but this real-meeting result is not release quality. See
`.agent/summary-quality-evidence-v12.27.json`.

Keep the React/Capacitor product and UI. The production capture correction is
now implemented; the remaining release blocker is physical qualification.
Supported Android 13+ native saved-audio inference is also implemented, with a
bounded Whisper compatibility fallback when the system service/model cannot
prove file-audio support. Native iOS/Android streamed imports and bounded
one-minute processing are implemented but not device-qualified. See
`.agent/RELIABILITY_OPTIONS.md` for the evidence and release gates.

## v12.27 grounded local summary quality

- The local worker now loads `gemma3-1b-it-q4f16_1-MLC`; the previous worker
  label said Gemma while its code loaded TinyLlama. The displayed runtime size
  now reflects the approximately 700 MB WebLLM requirement.
- Deterministic action items require an explicit assignment/commitment and task
  language; questions, suggestions, contingencies, general advice, and examples
  are excluded. Decisions require explicit group agreement/approval language.
- Long meetings supply a bounded 12,000-character evidence packet across six
  chronological windows. Model output must have all three sections and be
  grounded; verified extractive decisions/tasks cannot be displaced by model
  prose.
- Three realistic synthetic fixtures and the reusable local Ollama benchmark
  compare deterministic, Gemma-only, and guarded hybrid outputs. 93/93 tests
  pass. Web production build/lint, both native syncs, unsigned iOS Simulator
  build, and Android unit/assemble/lint also pass. The real phone meeting
  prevents a release-quality claim until a stronger long-meeting summarization
  strategy passes blinded human review.

## v12.26 visible recovery and accessible release flow

- Meeting deletion is now loss-safe: metadata remains in History until audio,
  transcript, and semantic artifacts all report successful deletion. A stalled
  or partial storage failure ends visibly and Retry remains available; active
  recording/transcription cannot be deleted underneath the job.
- Diagnostics export has a visible busy/result state and a 60-second whole-job
  deadline. Clipboard failure is visible, and the eight-stage Meeting
  Intelligence check has a 15-minute whole-job safety boundary.
- First launch no longer starts optional Whisper/Gemma downloads. The app
  explains that models are opt-in, and recording, deterministic private
  summaries, and full-text search remain available without them.
- The starter Vite theme and external Google Fonts request are removed. The app
  now uses system fonts/text scaling, explicit keyboard focus, reduced-motion
  and forced-colors support, 48px coarse-pointer targets, modal/current-page/
  form/progress/live-region semantics, and clearer setup/failure language.
- 87/87 tests, production web build/lint, both Capacitor syncs, the unsigned
  iOS Simulator build, and Android unit/assemble/lint pass (371 tasks). The
  rendered 390px flow has no horizontal overflow, current navigation is
  announced, critical inputs are named, keyboard focus has a 3px visible
  outline, diagnostics exports visibly, and all eight synthetic integrity
  stages pass without browser warnings/errors. Evidence:
  `.agent/build-evidence-v12.26.json` and
  `.agent/runtime-evidence-v12.26-web.json`.
- Physical locked 60-/120-minute capture, native saved-audio STT,
  interruption/memory-pressure delivery, destination-app receipt, largest
  system text, VoiceOver/TalkBack, and beta-user success rates remain release
  blockers. Browser/build proof does not close them.

## v12.25 bounded library operations and sequential backup recovery

- History full-text search and Ask now expose exact completed/total meeting
  progress while verifying archived transcripts one at a time. Both have a
  five-minute absolute scan limit; slow/corrupt storage ends visibly and Retry
  starts a fresh scan without changing saved content.
- Whole-library transcript hydration is sequential rather than `Promise.all`.
  Legacy transcript migration and backup restore also archive one body at a
  time, release each verified body from React memory, and retain the complete
  inline body whenever archival fails.
- Backup export/import show stage progress, have a 15-minute job boundary, and
  support Cancel. Cancel never rolls back verified archives or discards inline
  content; the same operation can be retried immediately.
- 79/79 tests prove scan deadline/progress, one-read hydration, sequential
  200-body restore, and loss-safe storage failure. Production build/lint, both
  native syncs, unsigned iOS Simulator build, and Android unit/assemble/lint
  pass (371 tasks). APK: 8,741,906 bytes; SHA-256
  `6e2060a87920406a8771ee1f40c8de85e360d879e94837189bc3d5f4769365f9`.
  Evidence: `.agent/build-evidence-v12.25.json`.
- The rendered app scanned 400 archived two-hour records with visible History
  (`2/400`) and Ask (`29/400`) progress, found the exact final marker, canceled
  backup visibly, then completed all 400 meetings on Retry. The refreshed
  eight-stage intelligence check passed at 2026-07-17T13:36:40Z; semantic and
  1,408,889-character storage harnesses passed, cleanup removed all 400
  fixtures, and the browser emitted no warnings/errors. Evidence:
  `.agent/runtime-evidence-v12.25-web.json`.
- Physical locked 60-/120-minute capture, native saved-audio STT,
  interruption/memory-pressure delivery, and destination-app receipt remain
  release blockers.

## v12.24 lazy, integrity-verified transcript library

- Startup no longer hydrates every archived transcript into React/WebView
  memory. Compact recovery metadata loads first; History displays archived
  bodies only on demand and **Hide Transcript** releases them from the DOM and
  application state again.
- History transcript search, Ask, and **Index All Meetings** verify archived
  transcripts sequentially, one meeting at a time. A shared scanner enforces
  the durable character/byte/fingerprint contract, honors cancellation, and
  fails visibly on a missing or altered archive instead of returning a partial
  library result.
- Ask retains only its top lexical candidates while scanning and validates
  semantic excerpts against chunks derived from the same current verified
  transcript. Large libraries therefore no longer require every hours-long
  body to coexist in WebView memory.
- A 500-archive regression proves maximum concurrent transcript reads is one;
  missing-archive scans fail closed. 76/76 tests, production build/lint, both
  native syncs, unsigned iOS Simulator build, and Android unit/assemble/lint
  pass (371 tasks). APK: 8,740,773 bytes; SHA-256
  `39bfef2b80d9222b03a340309914d4ae752ad8a7d6be290c179bb561b3954e67`.
  Evidence: `.agent/build-evidence-v12.24.json`.
- Rendered browser proof confirmed a two-hour archived transcript was absent
  from launch/History DOM, searchable by its exact final marker, loaded exactly
  on demand, and removed when hidden. The 1,408,889-character archive, semantic
  harness, and all eight intelligence steps passed at
  2026-07-17T13:17:32Z with complete 174,821-character Markdown and
  44-page/362,438-byte PDF, cleanup, and no browser warnings/errors. Evidence:
  `.agent/runtime-evidence-v12.24-web.json`.
- Physical locked 60-/120-minute capture, native saved-audio STT,
  interruption/memory-pressure delivery, and destination-app receipt remain
  release blockers.

## v12.23 bounded, resumable semantic indexing at scale

- Semantic freshness/count/diagnostic checks now read the complete vector
  object store in one bounded IndexedDB transaction. They no longer execute one
  sequential key lookup per meeting, which could multiply a 30-second storage
  deadline across a large archive and make launch, Ask, or Diagnostics appear
  stuck.
- Manual and automatic semantic indexing have a 15-minute whole-job safety
  limit in addition to the two-minute per-batch timeout. Manual indexing shows
  meeting and transcript-section progress, supports Cancel, retains every
  fully verified meeting index already committed, and resumes through **Index
  Remaining Meetings**. Cancellation/deadline never alters transcripts or
  lexical search.
- Index counts use only unique transcribed meetings. Saved audio awaiting
  transcription and explicit no-speech outcomes no longer make the UI show a
  permanently incomplete denominator.
- A 500-meeting regression proves freshness uses exactly one bulk transaction
  and zero per-meeting reads. 74/74 tests, production build/lint, both native
  syncs, exact unsigned iOS Simulator build, and Android unit/assemble/lint pass
  (371 tasks). APK: 8,740,068 bytes; SHA-256
  `8bc76dec5e0adf2ba83fea0742c4531c1ba8a3d8bc0096ece7e6f3ac155a00a8`.
  Evidence: `.agent/build-evidence-v12.23.json`.
- Real browser IndexedDB passed eight current/stale/schema/denominator checks;
  the 1,408,889-character archive round-trip and all eight intelligence steps
  passed at 2026-07-17T13:04:23Z with complete Markdown/PDF, cleanup, and no
  browser warnings/errors. Evidence: `.agent/runtime-evidence-v12.23-web.json`.
- Physical locked 60-/120-minute capture, native saved-audio STT,
  interruption/memory-pressure delivery, and destination-app receipt remain
  release blockers.

## v12.22 transcript-bound semantic search

- Every semantic index is now a versioned envelope bound to the exact meeting
  ID, transcript outcome, character/byte counts, whole-body checksum, chunk
  text sequence, and MiniLM embedding contract. Replacing or repairing a
  transcript under the same ID, changing the embedding contract, or finding a
  legacy/corrupt record makes the index stale instead of searchable.
- Ask excludes stale excerpts before ranking and continues complete hydrated
  lexical search. The UI identifies missing/outdated indexes and directs the
  user to **Index All Meetings**, which safely rebuilds them. Backup restore
  recounts current indexes without treating same-ID legacy vectors as valid.
- Diagnostics expose only content-free semantic health counts (`textMeetings`,
  `current`, `staleOrMissing`). No transcript, semantic excerpt, fingerprint,
  or model output is included.
- 73/73 tests, production build/lint, both native syncs, exact unsigned iOS
  Simulator build, and Android unit/assemble/lint pass (371 tasks). The APK is
  8,739,281 bytes (SHA-256
  `2f2cfafb58b9df278a2c1559cf052ad6ba981acc6aadf5b132dccab4ff1dcfd6`).
  Machine evidence: `.agent/build-evidence-v12.22.json`.
- Real browser IndexedDB proof passed all seven current/stale/schema checks. A
  separate 1,408,889-character archive round-trip hydrated exactly, and the
  rendered app passed all eight intelligence steps at
  2026-07-17T12:51:10Z: 174,104-character transcript, 174,821-character
  Markdown, 44-page/362,438-byte PDF, exact cleanup, and no browser
  warnings/errors. Evidence: `.agent/runtime-evidence-v12.22-web.json`.
- This closes the known same-ID stale semantic excerpt boundary. Physical
  locked 60-/120-minute capture, native saved-audio STT, interruption/memory-
  pressure delivery, and destination-app receipt remain release blockers.

## v12.21 durable transcript integrity and fail-closed intelligence

- Every completed text transcript now persists an explicit `text` outcome,
  UTF-16 character count, UTF-8 byte count, and versioned whole-body checksum
  beside the compact meeting metadata. A real `no_speech` result is explicit
  and carries the verified empty-body fingerprint; missing text is no longer
  silently relabeled as silence.
- Startup hydration, History search, Ask, semantic indexing, summaries,
  backup, Markdown/PDF/native share, GitHub, Calendar, and Email now validate
  archived text against that durable metadata before use. A missing, shortened,
  or same-length altered archive fails visibly and leaves saved audio/Retry and
  backup repair available instead of returning incomplete intelligence.
- Legacy non-empty archives are loaded once, fingerprinted, and compacted only
  after successful migration. Duplicate-ID backup recovery tolerates an
  unavailable current archive, restores the complete inline body, writes and
  reads it back exactly, and only then re-enables compact storage.
- Release diagnostics add a content-free completed-transcript-integrity
  assertion plus outcome/count/checksum-presence metadata; checksum values and
  all meeting content remain excluded.
- 69/69 tests, production build/lint, both native syncs, exact unsigned iOS
  Simulator build, and Android unit/assemble/lint pass (371 tasks). The final
  APK is 8,418,894 bytes (SHA-256
  `70997228c06e904c9873a34c99df12680b65383eedcd1515914a83ab48f109c6`).
  Machine evidence: `.agent/build-evidence-v12.21.json`.
- The rendered v12.21 browser stored, compacted, and exactly hydrated a
  1,408,889-character transcript with matching integrity metadata, then passed
  all eight complete intelligence steps at 2026-07-17T12:39:01Z. The synthetic
  174,104-character archive matched its whole-body fingerprint; Markdown ended
  at 174,821 characters, PDF ended on page 44 at 362,438 bytes, cleanup passed,
  and no browser warnings/errors occurred. Evidence:
  `.agent/runtime-evidence-v12.21-web.json`.
- This closes a source/runtime silent-corruption boundary. Physical locked
60-/120-minute capture, native saved-audio STT, interruption/memory-pressure
delivery, and destination-app receipt remain release blockers.

## v12.20 content-free reliability assertions and native pressure evidence

- Diagnostic exports now include strict content-free assertions for exact
  sorted segment manifests, durable non-sparse transcription prefixes, valid
  main/sub-checkpoint bounds, retained audio metadata for every resumable
  failure, completed transcript/summary outcomes, and any still-nonterminal
  meeting state. Meeting titles, transcript text, summary text, and action-item
  text are excluded; only counts, flags, IDs, byte/duration metrics, and
  sanitized terminal errors are emitted.
- Native recording telemetry now records complete session snapshots at start,
  foreground reconciliation, interruption/route changes, segment finalization,
  memory pressure, auto-stop, and stop. Each snapshot carries active state,
  exact segment/failure counts, committed bytes, recorded duration, and free
  space where available. iOS emits `UIApplication` memory warnings; Android
  forwards `onTrimMemory` levels without moving microphone ownership into the
  WebView or stopping healthy capture.
- Every native/browser free-space probe records either measured capacity or a
  visible diagnostic failure/unknown outcome. A memory-pressure event also
  renders a non-blocking notice while native capture continues and finalized
  segments remain authoritative.
- 65/65 tests, production build/lint, both native syncs, exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. The generated APK is
  8,418,894 bytes (SHA-256
  `0867048bb6e158e39bbfb8e600e24185842181a179908a012863702f3bf15c91`).
  Machine evidence: `.agent/build-evidence-v12.20.json`.
- The v12.20 production web UI passed all eight integrity steps at
  2026-07-17T12:18:39Z with the exact 174,104-character transcript,
  174,821-character Markdown, 44-page/362,438-byte PDF, no browser warnings or
  errors, and zero History artifacts. Evidence:
  `.agent/runtime-evidence-v12.20-web.json`. Physical memory-pressure injection,
  locked long-session capture, native saved-audio STT, and receiving-app receipt
  remain open.

## v12.19 late native-start and cleanup terminality

- Native recorder startup now owns a cancellation latch across listener
  registration and the platform start promise. A listener that resolves after
  cancellation is detached; capture is never started. If platform start itself
  resolves active after the 30-second UI deadline/recovery stop, the adapter
  issues a second bounded stop before rejecting the stale start result.
- Native recorder flush is bounded to 10 seconds and listener cleanup to five.
  Native import progress-listener attach/remove is bounded to five seconds; a
  listener that attaches after the deadline is removed asynchronously and
  cannot leak into another import.
- Native speech cleanup is bounded to five seconds before every new saved-audio
  transcription and after any native failure. An unconfirmed cancellation ends
  processing visibly, preserves audio/checkpoints, and directs the user to
  reopen before Retry so recognizers cannot overlap.
- Native/browser free-space checks now return `unknown` after five seconds
  instead of holding recorder startup or the serialized segment-write chain.
- 59/59 tests, production build/lint, both native syncs, exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. The generated APK is
  8,735,394 bytes (SHA-256
  `141cc6e82ca43f2cf49aa05bc3a03f13ca29e11afc07029959e3005e02332cad`).
  Machine evidence: `.agent/build-evidence-v12.19.json`.
- The v12.19 production web UI passed all eight integrity steps with exact
  transcript/Markdown/PDF markers, no browser warning/error logs, and zero
  History artifacts after cleanup. Evidence:
  `.agent/runtime-evidence-v12.19-web.json`. Physical late-start/cancel injection,
  locked long-session, and destination-app receipt remain open.

## v12.18 terminal model preparation and fallback readiness

- Whisper, Gemma, and MiniLM initialization now carry a correlated generation
  ID plus two independent terminal limits: progress resets an inactivity timer,
  but cannot extend the absolute preparation deadline. A timeout, explicit init
  error, worker crash, or synchronous start failure terminates the old worker,
  rejects dependent requests, and installs a clean replacement for manual Retry.
- Late progress/ready/error replies from an older generation cannot complete or
  corrupt a newer Retry. Failure is persisted and shown directly beside the
  affected model instead of leaving a permanent progress bar.
- Whisper failure preserves every saved audio/checkpoint and leaves Resume
  available after Retry. Gemma failure keeps the already-persisted deterministic
  summary. MiniLM failure keeps hydrated lexical search. Cached Whisper re-warm
  remains connected to bounded automatic transcription resume until it becomes
  ready or reaches a visible terminal failure.
- Launch-time native speech and Android decoder capability probes now end after
  five seconds. A stalled native speech probe immediately starts the bounded
  saved-audio Whisper fallback instead of preventing re-warm indefinitely.
- 57/57 tests, production build/lint, both native syncs, exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. The generated APK is
  8,734,716 bytes (SHA-256
  `cda114ad1a40387423d6553e7ab4f2c0ea713a6f77bd4571aef3919bc789c305`).
  Machine evidence: `.agent/build-evidence-v12.18.json`.
- The v12.18 production web UI passed all eight integrity steps with exact
  transcript/Markdown/PDF markers, no browser warning/error logs, and zero
  History artifacts after cleanup. A cached Gemma network failure also rendered
  a terminal inline error and Retry control while the fallbacks remained visible.
  Evidence: `.agent/runtime-evidence-v12.18-web.json`. Physical timeout injection,
  locked long-session, and destination-app receipt remain open.

## v12.17 semantic index integrity and worker-crash recovery

- Embedding replies must contain exactly the requested vector count, finite
  values, and one consistent dimension across every 16-chunk batch. A missing,
  malformed, NaN, or mixed-dimension response fails the indexing attempt before
  any IndexedDB replacement, preserving an older valid index.
- Stored vector records require contiguous chunk indexes from zero, non-empty
  text, consistent meeting IDs/dimensions, and finite values when indexed
  meeting IDs are enumerated. A corrupt or gapped record is treated as
  unindexed/rebuildable and is never ranked as a stale semantic result.
- An embedding-worker crash rejects all pending requests, clears loading/done
  model state, terminates the failed worker, installs a fresh worker, and shows
  a visible retry notice. Hydrated lexical search remains available throughout.
- 54/54 tests, production build/lint, both native syncs, exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. The generated APK is
  8,659,282 bytes (SHA-256
  `a8444af147d5846ea79523c74a75116452d005736d2c11e172f400d976a817d8`).
  Machine evidence: `.agent/build-evidence-v12.17.json`.
- The v12.17 production web UI passed all eight integrity steps with exact
  transcript/Markdown/PDF markers, no browser warning/error logs, and zero
  History artifacts after cleanup. Evidence:
  `.agent/runtime-evidence-v12.17-web.json`. Physical native recording,
  saved-audio transcription, and destination-app receipt remain open.

## v12.16 bounded recording startup and loss-safe timeout recovery

- Browser microphone acquisition and native/web recorder startup now end
  visibly after 30 seconds instead of leaving the Start action internally
  locked forever. A browser permission request that succeeds after timeout has
  every late track stopped immediately, preventing invisible capture.
- A timed-out recorder start requests a bounded stop and authoritative saved-
  audio scan. Verified stop/scan segments become a visible playable,
  transcription-interrupted meeting. An empty shell is removed only when both
  operations complete and prove no audio. Any uncertain stop or scan retains a
  recovery-required shell and deletes nothing.
- Optional start/stop haptics are bounded and non-blocking; a stalled haptic
  bridge cannot delay microphone capture or audio finalization.
- 51/51 tests, production build/lint, both native syncs, exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. The generated APK is
  8,658,700 bytes (SHA-256
  `b85f4595f6935a717b832ce23515003396dbda141eec6bcd655ae7c1d77249e4`).
  Machine evidence: `.agent/build-evidence-v12.16.json`.
- The v12.16 production web UI passed all eight integrity steps with exact
  transcript/Markdown/PDF markers, no browser warning/error logs, and zero
  History artifacts after cleanup. Evidence:
  `.agent/runtime-evidence-v12.16-web.json`. Physical start-timeout injection,
  locked long-session, and destination-app receipt remain open.

## v12.15 complete secondary handoffs and proactive summary repair

- GitHub, Calendar, and Email now pass through the same complete-transcript
  hydration and deterministic summary repair gate as Markdown/PDF/share. A
  partial inline transcript in an interrupted state cannot authorize any
  export.
- Startup hydration, backup creation, and backup restore proactively repair and
  persist missing summaries for completed transcripts. Restored/current
  transcript authority remains unchanged from v12.14.
- Email draft generation no longer slices content at 1,800 characters. If the
  complete encoded draft exceeds the conservative cross-client URL boundary,
  the UI explains the condition and uses the complete verified meeting share
  instead. Calendar files retain complete summary/action content.
- GitHub issue creation now has a 30-second deadline covering both response
  headers and response-body parsing. Timeout ends visibly and states that
  nothing was created.
- 46/46 tests, production build/lint, both native syncs, exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. The generated APK is
  8,658,086 bytes (SHA-256
  `d201e9e9c46f13c29469b5deadf945ab2a40f2fb1d514a7187b988604bea5e02`).
  Machine evidence: `.agent/build-evidence-v12.15.json`.
- The v12.15 production web UI passed all eight integrity steps with exact
  transcript/Markdown/PDF markers, no browser warning/error logs, and zero
  History artifacts after cleanup. Evidence:
  `.agent/runtime-evidence-v12.15-web.json`. Real destination-app receipt and
  physical long-session qualification remain open.

## v12.14 restored-content and export repair

- Backup merge now reconciles duplicate meeting IDs instead of blindly keeping
  compact current metadata. A backup transcript fills a missing current
  archive and is marked for verified archival before compaction; an existing
  valid current transcript remains authoritative. New meetings are still
  imported, and secrets remain excluded from backup output.
- Every transcript/Markdown/PDF export hydrates the complete archived
  transcript, then repairs and persists a missing deterministic summary before
  generating content. A meeting can no longer silently share `_No summary._`
  merely because the process stopped between transcript commit and summary
  persistence or because an older backup lacked summary fields.
- 43/43 tests, production build/lint, both native syncs, the exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. The generated APK is
  8,657,720 bytes (SHA-256
  `fa2187092d8b854456f58360320ee4ea31a11c4ba036616d25b35af3c7103bf6`).
  Machine evidence: `.agent/build-evidence-v12.14.json`. Physical long-session,
  restore/share, and destination-app receipt tests remain release gates.
- The v12.14 production web UI passed all eight Meeting Intelligence Integrity
  steps with the same exact 174,104-character transcript, 174,821-character
  Markdown, 44-page/362,438-byte PDF final marker, clean warning/error log, and
  zero History artifacts after cleanup. Evidence:
  `.agent/runtime-evidence-v12.14-web.json`. The new duplicate-ID backup and
  missing-summary branches are covered by focused automated tests; their native
  destination-app qualification remains open.

## v12.13 hours-scale playback, import recovery, and summary hardening

- Native segmented playback now resolves each app-container file to a direct
  Capacitor playback URL. This includes a native import stored as one multi-hour
  `seg-0`; the player no longer reads that entire file through the bridge as
  base64 or duplicates it in WebView memory. Web playback retains the bounded
  Blob/object-URL path, and every load still has a visible 15-second timeout and
  Retry Audio state.
- The eight-step on-device integrity check now loads metadata through the same
  production playback-source resolver, so its playback result no longer proves
  only a diagnostic base64 readback.
- A failed native import callback no longer authorizes immediate deletion. The
  app first scans authoritative protected storage: a verified atomically
  published file becomes a visible, playable, retryable meeting. If the scan
  itself fails, the recovery shell remains and nothing is deleted. Only a
  successful scan proving no completed audio permits cleanup.
- Cloud summary mode now persists the deterministic whole-meeting summary
  immediately and ends required processing before optional network work. Long
  transcripts use that bounded durable summary as the enhancement input; cloud
  or local model timeout/crash can no longer leave a saved meeting unsummarized.
- 38/38 tests, production build/lint, both native syncs, exact unsigned iOS
  Simulator build, and Android 4/4 unit/assemble/lint pass. The generated APK is
  8,657,425 bytes (SHA-256
  `aa6b4e3763696795a51a7f541c406aef42ce39f21a2382a4efa09dbf35bf9204`).
  Machine evidence: `.agent/build-evidence-v12.13.json`. Direct native playback,
  import callback recovery, and long-session behavior still require physical QA.
- The v12.13 app also passed all eight Meeting Intelligence Integrity steps
  through the real browser UI: production playback decoded, 9,644 audio bytes
  were rediscovered without metadata, 174,104 transcript characters hydrated
  exactly, middle/final summary and search markers survived, 174,821-character
  Markdown retained its last byte, the 44-page/362,438-byte PDF retained its
  final marker, cleanup left History at zero, and browser warning/error logs
  were empty. Evidence: `.agent/runtime-evidence-v12.13-web.json`. This is web
  runtime proof, not native physical qualification.

## v12.12 verified production native share boundary

- Production transcript, Markdown, and PDF exports now use one shared native
  file-preparation gate. The exact cache file is written, read back with the
  same UTF-8/base64 representation, compared to the complete prepared payload,
  and only then resolved to a URI and handed to the share sheet.
- A mismatch, read timeout, or missing URI produces a visible terminal error
  stating that nothing was shared. Android transcript sharing and the native
  Markdown export button now use the Capacitor native share sheet instead of a
  WebView download fallback.
- The two-hour integrity check uses this same production helper rather than a
  parallel diagnostic-only implementation. Three injected truncation tests
  prove mismatched Markdown/PDF never reach URI resolution. All 32 TypeScript
  tests, production build/lint, and both native asset syncs pass. The exact
  v12.12 unsigned iOS Simulator build and Android unit/assemble/lint gate now
  pass. The Android recovery suite is 4/4 and the generated debug APK is
  8,656,652 bytes (SHA-256
  `df716d31730cbf9c3b785ab9b4bf46e8d15cc2d3960bde2bf6d60c2091166e04`).
  Destination-app receipt remains physical QA. Machine-readable build evidence:
  `.agent/build-evidence-v12.12.json`.

## v12.11 Android cold-process recovery correction

- A recovery `STOP` delivered as the first command to a recreated Android
  service now rehydrates its protected recording snapshot before persisting
  terminal state. This prevents empty post-process-death Java fields from
  overwriting the durable meeting ID, segment manifest, byte count, failed
  indexes, duration, and next index.
- Exact `seg-n` files remain authoritative; `.partial`, `.partial.import`, and
  `.partial.m4a` tails are removed. Four focused JVM tests, TypeScript tests,
  production build/lint, Android assemble, and Android lint pass.
- This correction first shipped in v12.11. The installed API 34 integrity
  evidence below is from v12.10; v12.12 still requires its own runtime and
  physical qualification.

## v12.10 bounded native Android saved-audio transcription

- Android 13+ now decodes each requested saved-audio range natively to mono
  16 kHz PCM16 and streams it through a `ParcelFileDescriptor` pipe to the
  system on-device SpeechRecognizer. No PCM or inference payload crosses the
  WebView on the supported path.
- Before startup and before every transcription request, native code asks the
  recognizer whether the exact file-audio intent and installed English model
  are supported. It never starts an unverified intent because Android may
  otherwise fall back to microphone input.
- Each operation is bounded to one minute of audio and a three-minute terminal
  deadline, supports explicit cancellation, destroys its recognizer and pipe,
  treats verified silence as an empty completed unit, and leaves structural or
  transient failures visible/retryable at the existing `tSub*` checkpoint.
- Unsupported devices fail closed into the existing native MediaCodec plus
  bounded Whisper path. A permanent native capability failure disables only the
  native engine; it does not discard saved audio or completed checkpoints.
- Automated coverage is 29/29; TypeScript build/lint, Java compile, Android
  assemble, and API 34 runtime launch pass. On the isolated emulator, NativeSTT
  registered and returned `available:false` with the explicit reason that the
  English model was not installed, while NativeAudioDecoder returned available
  and the Whisper worker loaded. First-run and Studio screens rendered with
  large labeled controls. A host-load System UI ANR was emulator-wide; the
  MeetingGhost process remained alive and no app AndroidRuntime crash occurred.
- The final installed v12.10 APK also passed the eight-step two-hour-equivalent
  integrity check on that API 34 runtime. It recovered every one of 9,644 saved
  audio bytes without meeting metadata, hydrated all 174,104 transcript
  characters exactly, found the summary/search markers, and retained the final
  transcript byte in 174,821-character Markdown and a 44-page/362,438-byte PDF.
  The actual native cache files prepared for sharing were read back and matched
  byte-for-byte, the integrity-run error log was empty, the app stayed alive,
  and all synthetic audio/transcript/export files were removed. Machine
  evidence: `.agent/device-evidence-v12.10-android-integrity.json`.
- The subsequent v12.11 cold-process recovery audit found and fixed an Android
  service-state race:
  a recovery `STOP` delivered before the recreated service had rebuilt its Java
  fields could persist an empty meeting ID/manifest over the still-active
  SharedPreferences status. The service now reconstructs its exact committed
  segment IDs, bytes, failed IDs, recorded duration, next index, and recording
  directory from protected storage before marking the session inactive. Every
  `.partial`, `.partial.import`, and `.partial.m4a` tail is discarded while
  exact `seg-n` files remain. Four JVM fault-injection tests pass, followed by
  Android assemble and lint. A second emulator process-death run could not be
  started after reset because the host had 4.6 GB free while the API 34 image
  required 7.4 GB; this correction is source/unit/build verified, not a new
  physical-device claim.
- Boundary: no physical Android device has yet proven recognition accuracy,
  file-audio/no-microphone behavior, cancel/retry, memory, 30-minute/two-hour
  import completion, locked recording, or receipt by a destination app. The
  native file boundary is verified, but v12.12 is not device-qualified.

## v12.9 bounded native iOS import and Apple Speech

- iOS audio import now uses `UIDocumentPickerViewController` and coordinated,
  security-scoped reads to stream the selected document directly into
  `Documents/recordings/<id>/seg-0.partial.import`. No complete audio Blob or
  base64 copy enters WKWebView.
- Native copy exposes byte progress, enforces a 100 MB storage floor and
  ten-minute terminal deadline, fsyncs the destination, verifies exact byte
  length, and atomically publishes `seg-0`. Cancellation, provider failure,
  timeout, or process death leaves only an ignored partial file.
- `NativeSTT.info` verifies app-private paths and exact audio duration. Apple
  Speech receives contiguous one-minute CAF files decoded in 8,192-frame
  buffers rather than one hours-long request. Every completed minute is saved
  in the existing `tSub*` checkpoint, and Retry starts at the first missing
  unit.
- Apple Speech has an explicit native cancel method. Pause, Cancel, and the
  five-minute JavaScript watchdog stop the native task before persisting a
  visible resumable state, preventing an invisible timed-out recognizer from
  overlapping Retry.
- A two-hour-plus-321-ms fixture yields 121 exact native ranges; a separate
  resume fixture proves 79 completed Apple Speech units are retained and final
  assembly includes unit 121. Automated coverage is 28/28, TypeScript
  build/lint passes, and both simulator architectures compile in Xcode.
- Boundary: the document-provider stream, AVAudioFile decode, SpeechAnalyzer
  output, process-death resume, and 30-minute/two-hour memory profile have not
  run on a physical iPhone. This is source/build evidence, not qualification.

## v12.8 bounded native Android import and decode

- Android audio import now uses `ACTION_OPEN_DOCUMENT` and copies the selected
  content stream directly to `filesDir/recordings/<id>/seg-0.partial.import`.
  The WebView never receives the original hours-long file.
- Copy progress is visible every 8 MB. Native code enforces a 100 MB free-space
  floor, ten-minute terminal deadline, `fsync`, exact byte verification, and
  same-directory atomic rename to `seg-0`; incomplete partial files are ignored.
- Android transcription locates the saved private file directly. Native
  `MediaExtractor`/`MediaCodec` seeks and decodes contiguous one-minute ranges,
  downmixes/resamples them to mono 16 kHz PCM16, and returns only the bounded
  unit to Whisper. Every completed unit uses the existing durable subcheckpoint
  and Retry resumes at the first missing unit.
- The two-hour range fixture produces 121 contiguous units, including the final
  321 ms tail, and PCM bridge decoding verifies exact sample count and little-
  endian values. Automated coverage at that milestone was 27/27; production build/lint, Android
  `lintDebug`, and Android compile/assemble pass. The v12.8 browser bundle passes
  all eight integrity
  steps and leaves History empty.
- Boundary: Whisper inference itself is still in the Android WebView, native
  codec behavior has not run on physical Android hardware, and no Android
  device is connected. A configured API 34 x86 emulator launched but remained
  `adb offline` after cold boot and reconnect, so no APK/plugin execution was
  claimed. Do not claim long-import qualification from build tests.

## v12.7 native segmented capture outside the WebView

- iOS `AVAudioRecorder` and the Android foreground service's `MediaRecorder`
  now own microphone capture and rotation. React no longer calls
  `getUserMedia` for production mobile recording.
- Each platform records to an ignored partial file and atomically renames it to
  `seg-n` only after close and byte verification. The target rotation is 15
  seconds, so a process death cannot expose a corrupt tail as completed audio.
- Native storage checks, audio interruption/error handling, explicit start/
  stop/status/flush contracts, and segment progress events feed the existing
  meeting state machine. Android persists service status; a reloaded WebView
  finalizes an orphaned session before disk reconciliation.
- Returning from background reconciles native status so an auto-stop that
  occurred while JavaScript was suspended becomes visible. Finalization itself
  has a 30-second terminal timeout and falls back to recovery state.
- Startup now enumerates exact native/IndexedDB audio manifests independently
  of compact meeting metadata. If metadata was lost after audio committed, the
  app recreates a visible Recovered Meeting shell instead of leaving the audio
  inaccessible.
- The synthetic 25-cycle diagnostic explicitly injects its generated stream
  into the web recorder, so it remains microphone-free and cannot accidentally
  record a real conversation on mobile.
- Automated coverage is 25/25. The installed v12.7 browser bundle passed all
  eight full-chain integrity checks, including exact orphan-audio discovery,
  then removed its synthetic artifacts and left History at zero. TypeScript
  production build, lint, iOS Simulator Debug compile, and Android
  `assembleDebug` pass. This is build/browser evidence only; locked/background
  and hours-long physical tests are still required.

## v12.6 bounded import inference and terminal native I/O

- Web/Android Whisper now divides decoded imports into contiguous five-minute
  inference units instead of sending hours of PCM to one worker request. Every
  completed unit is persisted in the meeting recovery record (`tSubNext` and
  `tSubParts`), so a crash/timeout/cancel can resume within the containing
  imported-audio segment.
- Resume uses the first missing durable unit, and final assembly rejects any
  missing middle unit. History exposes both the audio-part and inference-chunk
  position instead of a generic processing state.
- Import persistence, saved-audio discovery, native file lookup/read, playback
  load, and native transcript/Markdown/PDF file preparation now have terminal,
  actionable timeouts. The operating-system share sheet itself is intentionally
  not timed out because the user may leave it open.
- The two-hour range fixture produces 24 lossless five-minute units with no gap
  or overlap. Automated coverage is 22/22; production build and lint pass.
- A fresh browser session displayed `Installed build: v12.6 · web`, retained
  the seven-pass integrity result, and produced no dev-server warnings/errors.
  Final assets are synced to iOS and Android; unsigned iOS Simulator Debug and
  Android `assembleDebug` both pass.
- Important boundary: the HTML file picker and web/Android decoder still load
  the original imported file as one blob/PCM allocation before bounded
  inference begins. True multi-hour import reliability requires a native
  zero-copy picker/copy plus streaming native decode/segmentation and physical
  30-minute/two-hour tests. v12.6 must not be represented as passing that gate.

## v12.5 on-device full-chain integrity check and temporal summary coverage

- Settings → Diagnostics now runs a synthetic two-hour meeting through the
  device's real durable audio write/read and decoder boundary, exact transcript
  archive/hydration, deterministic summary, cross-conversation search,
  Markdown construction, paginated PDF construction, and temporary cleanup.
- The first real browser run caught a summary-quality defect: repetitive
  meeting language consumed all five key points and hid late-meeting coverage.
  The deterministic summarizer now selects the strongest distinct sentence
  from each temporal third before filling globally, and treats numeric-only
  sentence variants as duplicates.
- The corrected browser run passed all seven checks: 9,644 audio bytes decoded
  as 0.300 seconds; 174,104 transcript characters hydrated exactly; middle
  decision and final action survived summary; exact search found the right
  meeting; 174,821-character Markdown ended with the final marker; a 44-page,
  362,438-byte PDF contained the final marker; temporary artifacts were removed.
- The check never inserts a meeting into History, never reads user content,
  persists a synthetic-only JSON result, and shows every failed step visibly.
- Automated coverage is now 20/20 tests, including a regression that forces
  distinct middle/final coverage across a repetitive long transcript.

## v12.4 terminal-state, search-order, playback, and native-PDF correction

- A saved recording that reaches transcription before its engine is ready now
  exits global Processing, shows an interrupted/retryable state, and keeps the
  audio. A bounded second native-engine probe closes the short-recording iOS
  startup race without creating another spinner.
- Retry reconstructs stale segment counts from the exact manifest or disk
  before falling back to legacy storage. Playback treats an exact manifest as
  authoritative even when a compact count is stale, resets safely after a
  manifest repair, and exposes read/decode failures.
- Exact full-text Ask matches are ranked before optional semantic results, so
  stale semantic hits cannot crowd a literal transcript match out of the
  five-source answer window.
- Optional summary/title refinement has a two-minute terminal timeout; the
  already-persisted deterministic full-meeting summary remains available.
- Native PDF export writes the complete binary PDF to app cache and passes the
  file URI to the operating-system share sheet. Browser PDF remains a complete
  paginated download, and regression coverage verifies the final transcript
  marker reached the last generated pages.
- If storage pressure prevents a transcription failure checkpoint from being
  persisted, the live UI still becomes visibly interrupted/retryable; relaunch
  normalizes the last durable in-flight state and the saved audio is untouched.
- Validation: 19/19 tests, lint, production build, and a fresh local-browser
  History/Ask fallback check pass with zero browser warnings/errors. Final
  v12.4 assets are synced to iOS/Android; unsigned iOS Simulator Debug and
  Android `assembleDebug` builds pass.

## v12.3 dependable meeting-intelligence hardening

- Whisper, Ask, summary, and title worker replies carry request IDs. A late
  response after a timeout is ignored and cannot complete a newer request or
  overwrite a different meeting.
- Optional LLM summary/title refinements retain their originating meeting ID;
  the complete deterministic summary is committed first and remains intact if
  refinement crashes or times out.
- Sparse/corrupt transcription checkpoints rewind to the first missing segment.
  Final assembly refuses any missing expected entry, including a middle gap;
  an explicit empty string still represents a valid silent segment.
- Canceling one transcription no longer leaves another recording permanently
  queued. The next saved meeting starts automatically.
- Ask hydrates every archived transcript before searching, always merges direct
  lexical matches with optional semantic results, and visibly falls back when
  the semantic worker or index is stale/unavailable.
- IndexedDB open and transaction operations are bounded (15s/30s), blocked
  upgrades are actionable, writes resolve only after transaction commit, and
  Retry opens a fresh connection after failure.
- Playback now shows loading, decode/read failures, and Retry Audio instead of
  silently disappearing or showing the previous part when a segment is absent.
- Saved-but-untranscribed meetings cannot produce deceptively blank exports.
  Native transcript sharing uses a real file, native Markdown sharing never
  falls back to potentially truncated text, object URLs are revoked, and PDFs
  include duration plus paginated complete content.
- Validation at that checkpoint: 17/17 tests, production build, lint, and a real local-browser
  navigation/Ask fallback check pass with zero browser warnings/errors. Final
  assets sync to both native projects; iOS Simulator Debug and Android
  `assembleDebug` builds pass.

## v12 reliability and usability baseline
- Summary and cross-conversation search are no longer gated by WebGPU/model downloads: every platform has deterministic local summary and full-text fallback paths.
- Optional LLM/embed worker requests now fail closed with crash rejection/timeouts instead of leaving Ask or indexing stuck forever.
- iOS interrupted transcription auto-resume accepts the native Apple Speech engine (it no longer incorrectly requires Whisper to be installed).
- Native sharing exports a complete Markdown file (summary, actions, transcript) to another app; PDF export paginates long transcripts.
- Regression coverage builds a 5,000-sentence hours-long Markdown export and
  verifies that duration, summary, action items, and the complete transcript
  reach the share artifact without truncation.
- v12.2 moves verified completed transcript bodies to a dedicated IndexedDB
  `content` store while retaining compact synchronous recovery metadata.
  Existing transcripts migrate loss-safely (write + exact read-back before the
  inline body is omitted), reload hydrates them for History/search/export, and
  backups explicitly contain hydrated text. A real-browser 1,408,889-character
  fixture compacted metadata from 1,429,105 characters to 217 and hydrated
  byte-for-byte exactly.
- Share, Markdown, PDF, and full backup now hydrate archived transcript content
  on demand. If a body is unavailable, export stops with an explicit error
  instead of silently producing an incomplete file.
- Mobile navigation is a persistent touch-first bottom bar. Core controls are at least 44pt, icon sizes are 19–22pt, inputs are 16pt, and first launch explains the workflow without presenting optional AI as a hard gate.
- The final v12.2 readability pass raises bottom-navigation labels to 12px,
  History action labels to 12px, status/panel labels to 15px, primary buttons
  to 15px with 46px targets, meeting titles to 18px, and keeps icons 19–22px.
- Long-session persistence now stores the exact verified segment manifest, so a single failed write cannot hide valid later audio. Stop is idempotent and waits for an in-flight rotation; dead microphone tracks and recorder errors auto-stop honestly.
- Android now implements the native `FreeDisk` bridge, making the 500 MB warning and 100 MB safe auto-stop real on both native platforms.
- Hours-scale post-processing is bounded: embedding batches contain at most 16 chunks, the optional local LLM refines the whole-meeting baseline for transcripts over 12k characters, search excerpts are capped, PDFs paginate, and durations display `h:mm:ss`.
- Physical iPhone 14 Pro Release proof now covers 15 continuous minutes: 15 verified segments, 13,596,559 bytes, exact 900s duration, native transcription `complete`, and no PID change (`.agent/device-evidence-v12-15min.json`). The 60-minute and two-hour tiers remain required.
- The first v12.0 60-minute run physically failed after lock/offline: only its
  first 834,342-byte segment survived and the process later disappeared. v12.1
  therefore adds an active native iOS `AVAudioSession` plus an Android
  foreground microphone service/partial wake lock. Both native builds pass;
  screen-lock and long-duration runtime proof must be repeated on v12.2.

## Transcription engines (v12 — per-platform)
- **iOS: native Apple Speech** via app-local plugin `NativeSTTPlugin.swift`
  (`NativeSTT` in JS). iOS 26+: SpeechAnalyzer/SpeechTranscriber (Apple's
  on-device model, system-managed assets, `AssetInventory` download,
  100% on-device). iOS <26: SFSpeechRecognizer with
  `requiresOnDeviceRecognition = true`. Segments are read directly from the
  app container by native code (extensionless files are staged to a tmp .m4a —
  AVFoundation needs a typed container). WHY: Whisper-WASM inference inside
  WKWebView trips the content-process memory ceiling → app exits to home
  screen. ML inference must not run inside the WebView on iOS.
- **Web: Whisper-WASM** (unchanged, proven reliable on desktop browsers).
- **Android 13+: native on-device SpeechRecognizer for verified saved audio.**
  Native MediaCodec produces one-minute mono PCM16 and passes it through the
  API 33 file-audio descriptor extras only after `checkRecognitionSupport`
  accepts the exact request and confirms an installed English model. Devices
  without that capability retain the bounded Whisper-WASM fallback; a bundled
  whisper.cpp/sherpa-onnx engine remains an option if measured coverage is low.
- Selection at runtime: `NativeSTT.available()` probe on native platforms;
  whisper worker stays cold when native STT is available. AI Models tab shows
  "Apple Speech (built-in)" on iOS and Android on-device speech capability on
  Android; onboarding skips Whisper only where native STT is actually ready.

## Tech Stack
- **Framework:** React 19 (Vite 8, TypeScript)
- **Styling:** Vanilla CSS (`App.css`), brushed gold / obsidian theme
- **Native Bridge:** Capacitor 8 (iOS via SPM `App.xcodeproj`, Android via Gradle)
- **Icons:** `lucide-react` (no brand icons — GitHub uses `CircleDot`)
- **PDF:** `jspdf`
- **AI Models (all on-device, downloaded on demand, cached in browser Cache API):**
  - Transcription: `@xenova/transformers` — Whisper tiny.en (WASM)
  - Summarization/Chat: `@mlc-ai/web-llm` — TinyLlama 1.1B (WebGPU)
  - Embeddings: `@xenova/transformers` — MiniLM-L6-v2 (WASM)
- **Optional cloud tier:** `@anthropic-ai/sdk` in-browser with the user's own key
  (`claude-opus-4-8`, structured outputs) — direct device→Anthropic, no middleman

## System Architecture

### Main thread (`src/App.tsx`)
UI + state plus adapters for native mobile capture and browser MediaRecorder.
Tabs: Studio, History, Ask, AI Models, Settings. iOS/Android production capture
is native; MediaRecorder remains only for PWA/web and synthetic diagnostics.
All AI work is off-thread in three Web Workers created on mount.
**Workers are re-warmed on startup** for any model persisted as installed —
without this, transcription dies after reload ("Transcriber not initialized").

### Workers (`src/workers/`)
- `whisper.worker.ts` — init/transcribe; queues transcribe behind in-flight init;
  aggregates per-file download progress into one percentage.
- `llm.worker.ts` — summarize (template-driven `systemPrompt`), autoTitle, chat.
- `embed.worker.ts` — MiniLM embeddings with requestId-correlated responses.

### Persistence
- `localStorage` via `src/utils/store.ts`: compact `mg_h` meeting/recovery
  metadata (large completed transcript bodies are omitted after verified
  archival), `mg_f` folders,
  `mg_settings` (viz theme, highlight toggle, template, Claude key, GitHub token/repo),
  `mg_w`/`mg_g`/`mg_e` model states, `mg_onb` onboarding.
- `IndexedDB` (`meetingghost` DB v2 via `src/utils/idb.ts`): `vectors` store
  (per-meeting chunk embeddings), `audio` store (recording blobs for playback),
  and `content` store (verified large transcript bodies).
- Backup export strips `claudeKey` and `githubToken`.

### Pipeline (v10: segmented save-first — durable during recording)
`start()` creates the meeting record (status `recording`) BEFORE capture begins.
`SegmentedRecorder` (utils/recorder.ts) rotates MediaRecorder every 60s so each
segment is an independently decodable file, written + size-verified to durable
storage (utils/audioStore.ts: native = Capacitor Filesystem `Directory.Data`,
web fallback = IndexedDB) the moment it closes. visibilitychange / pagehide /
appStateChange / track-mute all force an immediate flush of the in-flight
segment. Storage checked at start + every segment (app-local Swift plugin
`FreeDiskPlugin` for true device free space; warn <500MB, auto-stop <100MB).
`stop()` awaits every verified write, marks `saved`, THEN queues transcription.

Transcription (`runTranscription`) is a separate resumable stage over saved
audio only: one segment at a time (bounded memory), `tNext`/`tParts` checkpoint
persisted after EVERY segment, 5-min stall watchdog, pause/cancel (cancel keeps
audio), retries counted (3 → `transcription_failed`), whisper `worker.onerror`
surfaces crashes. Then summary/title stream in as updates (status stays
`complete` once the transcript is saved).

State machine (store.ts `MeetingStatus`): recording → saved → queued →
transcribing → complete, with transcription_interrupted / transcription_failed /
recovery_required. On launch, states are reconstructed: in-flight statuses
normalize to interrupted (resumable), `recording` reconciles against segments
actually on disk (`countSegmentsOnDisk`).

Diagnostics (utils/diag.ts): 600-event ring buffer in localStorage — state
transitions, segment writes, storage, lifecycle, worker events, sanitized
errors; never meeting content. Settings → Export Diagnostics.

**CRITICAL (learned the hard way):** whisper transcription of >30s audio MUST
pass `return_timestamps: true` — the chunk stitcher aligns 30s windows by
timestamp tokens; without it a 2-minute recording collapses to a few words.
Test with >30s audio, not just short clips.

**iOS specifics:** Info.plist has `UIBackgroundModes: audio`; v12.1 also owns
an active `.playAndRecord` `AVAudioSession` through `RecordingSessionPlugin`
for the duration of capture. Local Capacitor plugins are registered via MainViewController
(storyboard customClass) — new Swift files must be added to project.pbxproj
manually (no synchronized groups).

### Feature modules (`src/utils/`)
- `intelligence.ts` — summary templates, action-item parsing, Claude API calls
- `vectors.ts` — sentence-aware chunking, cosine search over IDB
- `integrations.ts` — GitHub issue export, .ics follow-up, mailto, markdown
- `highlight.tsx` — action-word highlighting

## Known Limitations
- WebGPU absent on most mobile WebViews → the optional generative summarizer is unavailable; the built-in deterministic private summary remains available.
- TinyLlama structure adherence is loose; action-item parsing is best-effort
  on the local path (cloud path is schema-enforced).
- Native capture now exists on iOS and Android, but the v12.12 path still
  requires physical lock/background, interruption, route, low-storage, and
  60-/120-minute proof before it can be called dependable.
- Android 13+ uses native saved-audio speech only when the exact file-audio
  request and installed English model are proven. Unsupported devices fall
  back to bounded Whisper-WASM. Neither Android path has physical-device
  long-session evidence, so lower-memory Android support remains unqualified.
- Neither native mobile platform allocates the whole imported file/decoded PCM
  in its WebView. Their 30-minute/two-hour import paths remain physically
  unqualified; web still performs whole-file browser decode before bounded
  inference.
- If iOS kills the app mid-transcription the transcript pauses — but the
  recording is already saved; the user retries from History (save-first design).

## Mobile UI (v12.2)
- ≤640px: header stacks; nav becomes a full-width 5-column tab bar
  (icons above labels) — never overflows a 390pt iPhone 14.
- Text colors tuned for OLED: `--text-secondary #b3b9cc` (≥7:1),
  `--text-muted #8b92ab` (≥4.5:1). Mobile content/status text is 15px,
  inputs are 16px, meeting titles are 18px, nav/action labels are 12px,
  icons are 19–22px, and core targets are at least 44px. Do not reintroduce
  smaller labels, dimmer values, or icon-only controls without accessible text.

## Build notes
- Gradle needs JDK 21 (`JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`).
- iOS builds from `ios/App/App.xcodeproj` (no workspace; Capacitor 8 SPM).
- `npx cap sync android` / `ios` explicitly; bare `sync` has skipped android before.
- Final v12.21 web assets are synced to both native projects. The exact v12.21
  unsigned iOS Simulator Debug build and Android 4/4 unit tests,
  `assembleDebug`, and `lintDebug` pass. The paired iPhone 14 Pro is registered
  and Developer Mode is enabled, but the fresh `devicectl` check reports it
  `unavailable`; it runs iOS 26.5.2 while the host has
  Xcode 26.3. The latest signed Release destination attempt on 2026-07-17
  timed out because the developer disk image could not be mounted, so no
  current app was installed. Update Xcode/device support (or use a supported
  physical device), then rerun the matrix.
