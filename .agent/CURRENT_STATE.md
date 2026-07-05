# Current Architectural State
**Last Updated:** MeetingGhost Gold v9.1 (2026-07-05)

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
UI + state + MediaRecorder. Tabs: Studio, History, Ask, AI Models, Settings.
All AI work is off-thread in three Web Workers created on mount.
**Workers are re-warmed on startup** for any model persisted as installed —
without this, transcription dies after reload ("Transcriber not initialized").

### Workers (`src/workers/`)
- `whisper.worker.ts` — init/transcribe; queues transcribe behind in-flight init;
  aggregates per-file download progress into one percentage.
- `llm.worker.ts` — summarize (template-driven `systemPrompt`), autoTitle, chat.
- `embed.worker.ts` — MiniLM embeddings with requestId-correlated responses.

### Persistence
- `localStorage` via `src/utils/store.ts`: `mg_h` meetings, `mg_f` folders,
  `mg_settings` (viz theme, highlight toggle, template, Claude key, GitHub token/repo),
  `mg_w`/`mg_g`/`mg_e` model states, `mg_onb` onboarding.
- `IndexedDB` (`meetingghost` DB via `src/utils/idb.ts`): `vectors` store
  (per-meeting chunk embeddings), `audio` store (recording blobs for playback).
- Backup export strips `claudeKey` and `githubToken`.

### Pipeline (v9.1: save-first — nothing can be lost)
record/upload → `beginMeeting`: record saved to localStorage with
`status:'processing'` AND audio blob persisted to IDB **before any AI work** →
resample 16kHz → whisper worker (chunked, `return_timestamps:true`, per-chunk
progress) → transcript written via `updateMeeting` + `status:'done'` + semantic
index → summary/title stream in as further updates.
On startup, stale `status:'processing'` records flip to `'error'` (retryable);
History shows a status chip and a "Retry Transcription" button backed by the
stored audio. Screen wake-lock held while recording/processing.

**CRITICAL (learned the hard way):** whisper transcription of >30s audio MUST
pass `return_timestamps: true` — the chunk stitcher aligns 30s windows by
timestamp tokens; without it a 2-minute recording collapses to a few words.
This was the iPhone "recorded 2 min, got nothing" bug. Test with >30s audio,
not just short clips.

### Feature modules (`src/utils/`)
- `intelligence.ts` — summary templates, action-item parsing, Claude API calls
- `vectors.ts` — sentence-aware chunking, cosine search over IDB
- `integrations.ts` — GitHub issue export, .ics follow-up, mailto, markdown
- `highlight.tsx` — action-word highlighting

## Known Limitations
- WebGPU absent on most mobile WebViews → local summarizer unavailable there
  (UI states this; transcription + BYO-key Claude still work).
- TinyLlama structure adherence is loose; action-item parsing is best-effort
  on the local path (cloud path is schema-enforced).
- Recording stops when the app is backgrounded (no native background audio service yet).
- If iOS kills the app mid-transcription the transcript pauses — but the
  recording is already saved; the user retries from History (save-first design).

## Mobile UI (v9.1)
- ≤640px: header stacks; nav becomes a full-width 5-column tab bar
  (icons above labels) — never overflows a 390pt iPhone 14.
- Text colors tuned for OLED: `--text-secondary #b3b9cc` (≥7:1),
  `--text-muted #8b92ab` (≥4.5:1). Transcript blocks use primary/secondary,
  13px/12.5px mono. Don't reintroduce dimmer values.

## Build notes
- Gradle needs JDK 21 (`JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`).
- iOS builds from `ios/App/App.xcodeproj` (no workspace; Capacitor 8 SPM).
- `npx cap sync android` / `ios` explicitly; bare `sync` has skipped android before.
