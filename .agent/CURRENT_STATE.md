# Current Architectural State
**Last Updated:** MeetingGhost Gold v9.0 (2026-07-05)

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

### Pipeline
record/upload → resample 16kHz (`utils/audio.ts`) → whisper worker →
`runSummarization` (cloud Claude if enabled+key, else local LLM, else transcript-only)
→ auto-title → save → auto semantic index + audio blob persisted.
Empty transcripts short-circuit with "No speech detected".

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

## Build notes
- Gradle needs JDK 21 (`JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`).
- iOS builds from `ios/App/App.xcodeproj` (no workspace; Capacitor 8 SPM).
- `npx cap sync android` / `ios` explicitly; bare `sync` has skipped android before.
