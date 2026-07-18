# MeetingGhost Gold

**Private, on-device meeting transcription and intelligence.** Record or import meetings, get transcripts, structured AI summaries, action-item checklists, semantic search, and playback — all processed locally on your device. No accounts, no cloud storage, no subscriptions.

## Features (v12.25)

- **Native long-form mobile recording** — iOS/Android own microphone capture and atomically commit independently playable 15-second checkpoints in app-private storage; web uses verified 60-second checkpoints; microphone/startup waits are bounded, a native start resolving after cancellation is stopped again, and recovery reconciles verified or uncertain audio without silent deletion
- **On-device transcription** — iOS checkpoints bounded one-minute native Apple Speech units; Android 13+ uses a support-checked on-device SpeechRecognizer file-audio pipe when the required English model is installed; Whisper remains the web and unsupported-Android fallback
- **Always-available summaries** — a deterministic private summary is persisted immediately on every device; an older/restored meeting with a complete transcript but no summary is repaired before export; bounded TinyLlama/WebGPU and optional BYO-key Claude work only as enhancements
- **Summary templates** — General, Standup, Sales Call, Interview
- **Action-item checklists** — extracted per meeting, checkable and persistent
- **Ask Your Meetings** — built-in full-text search across all transcripts, with exact matches ranked ahead of optional MiniLM semantic suggestions and AI answers; every vector index is bound to the exact transcript and embedding schema, so repaired/legacy/corrupt indexes are excluded and visibly rebuilt without weakening lexical search
- **Bounded semantic indexing** — freshness uses one IndexedDB bulk read at any meeting count; long indexing shows meeting/chunk progress, can be canceled, stops at a 15-minute hard limit, preserves completed meeting indexes, and resumes remaining work without blocking full-text search
- **Corruption-safe intelligence** — worker replies and model initialization generations are request-correlated; Whisper, Gemma, and MiniLM preparation have inactivity plus absolute deadlines, visible retry states, and fresh-worker recovery; incomplete or mixed-dimension embedding batches cannot replace a valid index; sparse transcription checkpoints rewind instead of skipping content
- **Bounded import transcription** — iOS and Android native pickers stream directly to protected storage without a WebView Blob. Import listener setup/cleanup, native speech cancellation, storage probes, and transcription units have terminal deadlines; Apple Speech and Android MediaCodec emit one-minute native units while web uses five-minute inference units after browser decode. Every unit is checkpointed and resumable
- **On-device integrity check** — Diagnostics verifies real audio save/decode, metadata-loss audio rediscovery, exact transcript hydration, temporal summary coverage, search, complete Markdown, final-page PDF content, native share-file byte equality, and cleanup with synthetic two-hour data
- **Content-free reliability diagnostics** — exported support evidence now asserts exact segment manifests, durable checkpoint prefixes, retained audio for resumable failures, complete transcript/summary outcomes, and nonterminal states without including meeting titles, transcripts, summaries, or action-item text; native memory pressure, route/interruption, finalized bytes/duration, free space, retries, and terminal outcomes are recorded
- **Optional BYO-key Claude tier** — paste your own Anthropic API key for premium structured summaries and chat answers; transcript goes directly from your device to Anthropic, never through a middleman server. Falls back to on-device automatically.
- **Playback** — recordings persist in native app storage or IndexedDB with a manifest-aware 0.5–2.5x segmented player and visible retry states; native recordings and multi-hour imports stream directly from protected files instead of being copied into WebView memory as base64
- **Organization** — folders, live search, keyword highlighting
- **Memory-bounded transcript library** — app launch keeps archived transcript
  bodies out of React/WebView memory; History search, Ask, and bulk indexing
  verify archives one at a time, while View/Hide loads and releases one complete
  transcript without changing its durable copy
- **Bounded backup and library jobs** — History/Ask show exact meeting progress
  and stop at a five-minute safety limit; backup/migration/restore archive one
  transcript at a time, show progress, support Cancel, and preserve every
  verified archive or complete inline body for immediate Retry
- **Verified native sharing** — transcript, Markdown, and paginated PDF files are read back exactly after their native cache write; a mismatch stops before the share sheet instead of sending truncated content
- **Integrations** — send complete Markdown and paginated PDF files to another app; GitHub, Calendar, and Email hydrate the saved transcript and repair missing summaries first; GitHub has a terminal timeout and long email drafts fall back to the complete share artifact instead of being truncated
- **Backup** — full-database JSON export/import (API keys always excluded); restoring a duplicate meeting repairs missing transcript content without overwriting a valid current transcript

Native capture and bounded native mobile transcription are implemented and
build-verified, but locked 60-minute/two-hour recording and long-import claims
remain gated on the physical-device protocol in
`.agent/IPHONE_TEST_PROTOCOL.md`.

## Platforms

| Platform | How |
|---|---|
| Web / PWA | Vite + React 19; works fully offline after model downloads |
| iOS | Capacitor 8 (`ios/App/App.xcodeproj`) |
| Android | Capacitor 8 (`android/`, Gradle) |

WebGPU is optional. Devices without it still receive a local structured summary and cross-meeting full-text search; the downloaded models improve summary and semantic-search quality.

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
- `src/utils/` — `store.ts` (compact recovery metadata), `idb.ts` (bounded IndexedDB transactions: vectors + audio + transcript content), `nativeRecorder.ts` (native capture bridge/recovery), `vectors.ts` (chunking/search), `intelligence.ts` (templates, action items, Claude API), `integrations.ts` (GitHub/ICS/email/markdown), `requestRegistry.ts`/`transcriptionState.ts` (late-response and checkpoint safety), `audio.ts`/`audioChunks.ts` (resampling and bounded inference ranges)
- `.agent/` — living project docs for AI-assisted development (PRD, roadmap, state, tasks)
