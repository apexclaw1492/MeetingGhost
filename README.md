# MeetingGhost Gold

**Private, on-device meeting transcription and intelligence.** Record or import meetings, get transcripts, structured AI summaries, action-item checklists, semantic search, and playback — all processed locally on your device. No accounts, no cloud storage, no subscriptions.

## Features (v9.0)

- **On-device transcription** — Whisper (via transformers.js/WASM) in a Web Worker
- **On-device summaries** — TinyLlama (via WebLLM/WebGPU): key points, decisions, action items
- **Summary templates** — General, Standup, Sales Call, Interview
- **Action-item checklists** — extracted per meeting, checkable and persistent
- **Ask Your Meetings** — semantic search across all transcripts (local MiniLM embeddings + IndexedDB vector store) with AI answers and source excerpts
- **Optional BYO-key Claude tier** — paste your own Anthropic API key for premium structured summaries and chat answers; transcript goes directly from your device to Anthropic, never through a middleman server. Falls back to on-device automatically.
- **Playback** — recordings persist locally (IndexedDB) with a 0.5–2.5x speed player
- **Organization** — folders, live search, keyword highlighting
- **Integrations** — export action items as a GitHub issue, download a calendar follow-up (.ics), draft an email, PDF/Markdown export, native share sheet
- **Backup** — full-database JSON export/import (API keys always excluded)

## Platforms

| Platform | How |
|---|---|
| Web / PWA | Vite + React 19; works fully offline after model downloads |
| iOS | Capacitor 8 (`ios/App/App.xcodeproj`) |
| Android | Capacitor 8 (`android/`, Gradle) |

WebGPU is required for the on-device summarizer; where it's missing (most mobile WebViews today) the app degrades gracefully to transcription-only, and the BYO-key Claude tier still provides summaries.

## Development

```sh
npm install
npm run dev        # local dev server
npm run build      # type-check + production build
npm run lint       # oxlint

npx cap sync       # copy dist/ into the native projects
# Android (needs JDK 21; Android Studio's bundled JBR works):
cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug
# iOS:
cd ios/App && xcodebuild -project App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' build
```

## Architecture

- `src/App.tsx` — UI, state, MediaRecorder, worker orchestration
- `src/workers/` — `whisper.worker.ts` (STT), `llm.worker.ts` (summaries/chat), `embed.worker.ts` (embeddings)
- `src/utils/` — `store.ts` (localStorage), `idb.ts` (IndexedDB: vectors + audio), `vectors.ts` (chunking/search), `intelligence.ts` (templates, action items, Claude API), `integrations.ts` (GitHub/ICS/email/markdown), `audio.ts` (resampling)
- `.agent/` — living project docs for AI-assisted development (PRD, roadmap, state, tasks)
