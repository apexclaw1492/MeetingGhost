# Goals 2 and 3 Audit and Remediation — v12.26

**Audit date:** 2026-07-17  
**Baseline:** `1365a0970ab781c0ade541d7044c486176e0778d`  
**Scope:** failure recovery/observability and release-grade usability/accessibility

## Evidence boundary

The v12.25 source and evidence already prove strong save-first recording,
checkpointed transcription, transcript integrity, bounded model/library jobs,
loss-safe backup, complete Markdown/PDF construction, and browser-rendered
progress/cancel/retry at scale. They do not prove the physical mobile matrix,
VoiceOver/TalkBack, largest system text, destination-app receipt, or beta-user
success rates. Those claims remain explicitly unproven.

## Initial live-source findings

| Requirement | Initial result | Evidence / gap |
|---|---|---|
| Privacy-safe local launch | **FAIL** | `App.css` imports Google Fonts, creating an unnecessary external request. |
| Consistent dark app shell | **FAIL** | `index.css` still contains the Vite starter theme, light/dark color scheme, root border, fixed width, and conflicting typography. |
| Keyboard focus visibility | **FAIL** | No global `:focus-visible` treatment exists; the search input explicitly removes its outline. |
| Reduced motion | **FAIL** | Shimmer, spinner, recording rings, transitions, and smooth scrolling have no `prefers-reduced-motion` override. |
| Modal semantics and initial focus | **FAIL** | First-launch overlay lacks `role="dialog"`, `aria-modal`, labelled/described relationships, and explicit initial focus. |
| Navigation semantics | **PARTIAL** | Tabs are labelled visually but the navigation has no accessible name and the current page is not exposed with `aria-current`. |
| Form labels | **FAIL** | History/Ask inputs, meeting-folder selects, template selection, and integration credential fields rely on placeholders or nearby unassociated labels. |
| Progress semantics | **FAIL** | Model progress is visual only; progress bars have no `progressbar` role or numeric ARIA values. |
| Status/error announcements | **PARTIAL** | Some job banners have live roles, but global notices, recording/saved state, and global errors are not consistently announced. |
| Coarse-pointer target size | **PARTIAL** | Core controls are at least 44 px, but Android’s requested 48 dp coarse-pointer minimum is not enforced consistently. |
| System text scaling | **PARTIAL** | Readable overrides exist, but conflicting root CSS and missing text-size adjustment weaken WebView/system scaling behavior. |
| First-launch choice | **FAIL** | Completing onboarding can immediately start large Whisper/Gemma downloads without a separate user decision. |
| Destructive-action safety | **PARTIAL** | Meeting deletion is confirmed, but metadata disappears before audio/content/vector deletion succeeds and storage failures are swallowed; folder removal is unconfirmed. |
| Clipboard/diagnostic failure visibility | **FAIL** | Clipboard failure is swallowed; diagnostic export lacks a visible busy/failure boundary and an overall deadline. |
| Integrity-check terminality | **PARTIAL** | Individual production steps are mostly bounded, but the UI call has no whole-job safety deadline. |
| Core recording/transcription recovery | **PASS SOURCE/AUTOMATED** | v12.25 tests and evidence cover bounded startup, late callbacks, saved checkpoints, native recovery, model failures, sparse manifests, and retained audio. Physical mobile injection remains open. |
| Large libraries and hours-long artifacts | **PASS BROWSER/AUTOMATED** | 400-meeting rendered workflow, 500-meeting storage regressions, exact large transcript, Markdown, and 44-page PDF evidence pass. |

## Objective pass criteria for this goal

1. No launch-time third-party font/network request is present.
2. Keyboard users can always see focus; first-launch focus enters a correctly
   named modal; current navigation and all critical inputs are announced.
3. Reduced-motion mode removes nonessential animation and smooth scrolling.
4. Coarse-pointer controls meet a 48 px minimum without shrinking existing
   readable text; system/WebView text scaling is not disabled.
5. Optional model downloads require an explicit user action and never block
   recording, deterministic summary, or full-text search.
6. Model progress exposes numeric accessible progress; recording, processing,
   success, and failure messages use appropriate live semantics.
7. Destructive deletion keeps the meeting visible until all storage deletion
   attempts succeed; any partial failure is visible and retryable.
8. Clipboard, diagnostic export, and integrity-check failures terminate visibly;
   diagnostics and integrity checks have whole-operation deadlines.
9. Regression tests cover the new failure and accessibility contracts.
10. Tests, lint, production build, native sync/build gates, and rendered critical
    workflows pass, with physical-device and assistive-technology gaps reported
    rather than inferred.

## Remediation result

| Criterion | Result | Current evidence |
|---|---|---|
| Private local launch / consistent shell | **PASS SOURCE/BUILD** | External font import and Vite starter theme removed; system font and dark shell are local. |
| Focus, modal, navigation, forms, progress, live states | **PASS SOURCE/BROWSER** | Automated accessibility contract passes; rendered current navigation/inputs are named; keyboard focus shows a 3px outline. |
| Reduced motion, forced colors, text scaling, target size | **PASS SOURCE; PARTIAL RUNTIME** | CSS contracts pass; 390px flow has no horizontal overflow and primary controls are at least 44px. Coarse pointer enforces 48px. Largest system text/assistive tech remain physical gates. |
| Explicit optional model choice | **PASS SOURCE/TEST** | Onboarding no longer invokes model preparation and explains local fallbacks. |
| Loss-safe destructive actions | **PASS SOURCE/TEST** | Metadata removal follows successful audio/transcript/vector cleanup; partial failure and timeout tests retain a visible retryable meeting. |
| Support-operation terminality | **PASS SOURCE/TEST/BROWSER** | Clipboard failure is visible; diagnostics has a 60s deadline and rendered success; integrity has a 15m deadline and all eight stages pass. |
| Recording/transcription/export/search completeness | **PASS AUTOMATED/BROWSER/BUILD** | 87 tests and the synthetic two-hour full-chain check pass, including exact transcript hydration, full-text marker, complete 174821-character Markdown, 44-page PDF, and cleanup. |
| Native platform compilation | **PASS BUILD** | Final web assets synced; unsigned iOS Simulator build and Android unit/assemble/lint pass. |
| Physical reliability and assistive technology | **UNPROVEN / RELEASE BLOCKER** | Locked 60/120-minute iOS/Android capture, native saved-audio STT, interruption/memory pressure, receiving-app receipt, VoiceOver/TalkBack, largest text, and beta telemetry are not proven. |

## Objective readiness score

| Dimension | Weight | Score | Basis |
|---|---:|---:|---|
| Durable recording/recovery architecture | 25 | 21 | Strong native segmented/save-first implementation and tests; long locked physical runs pending. |
| Transcription, summary, search, playback, export completeness | 25 | 23 | Full-chain synthetic and artifact integrity pass; native long-file and destination receipt pending. |
| Visible terminal failure/retry behavior | 20 | 19 | Known UI support/deletion gaps fixed and regression tested; physical fault injection pending. |
| Usability and accessibility | 15 | 12 | Source/390px browser contracts pass; assistive technology and largest text pending. |
| Cross-platform release evidence | 15 | 7 | Web, iOS Simulator, Android build/emulator evidence pass; current physical matrix is absent. |
| **Total** | **100** | **82** | **Strong beta candidate after install, not yet qualified for dependable hours-long release claims.** |

## Next decisive goals

1. Pass the v12.26 physical reliability matrix on iPhone plus a lower-memory and
   current Android device, prioritizing lock/background, 60/120-minute capture,
   force-kill recovery, native saved-audio transcription, and memory pressure.
2. Pass receiving-app and accessibility qualification: Markdown/PDF to real
   destination apps, VoiceOver/TalkBack, largest text, Display Zoom, reduced
   motion, and 320–430pt layouts.
3. Run a measured beta reliability program with privacy-safe diagnostics and
   publish rates for successful save, automatic/resumed transcription, complete
   export, unrecovered failure, processing time, and peak memory by device/OS.
