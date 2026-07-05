# Current Architectural State
**Last Updated:** MeetingGhost Gold (v4.0)

## Tech Stack
- **Framework:** React 18 (Vite)
- **Styling:** Vanilla CSS (`App.css`)
- **Native Bridge:** Capacitor (iOS, Android, Web)
- **Icons:** `lucide-react`
- **PDF Generation:** `jspdf`
- **AI Models:**
  - Transcription: `@xenova/transformers` (Whisper tiny.en)
  - Summarization: `@mlc-ai/web-llm` (TinyLlama 1.1B Chat)

## System Architecture

### 1. Main Thread (`src/App.tsx`)
- Handles UI, state management, and `MediaRecorder` logic.
- Audio from the microphone is captured in chunks, resampled to 16kHz Float32 using `src/utils/audio.ts`, and dispatched to the Web Workers.
- Persists meeting records to `localStorage` under keys `mg_h` (history), `mg_w` (whisper state), and `mg_g` (gemma/tinyllama state).

### 2. Web Workers
To keep the UI running at 60fps, all AI inference is offloaded to two Web Workers:
- **`src/workers/whisper.worker.ts`**: 
  - Loads the pipeline on initialization.
  - Receives `Float32Array` audio, processes it, and streams `status: 'progress'` back.
  - Returns `status: 'complete'` with the full text transcript.
- **`src/workers/llm.worker.ts`**:
  - Requires WebGPU support.
  - Receives text payloads.
  - Processes `type: 'summarize'` (generates meeting notes) and `type: 'autoTitle'` (generates a 3-5 word title).

### 3. Styling Paradigm (`src/App.css`)
- **Viewport:** Uses `100dvh` heavily to fix Safari iOS address bar collapse issues.
- **Floating Action:** The Record button is nested inside `.floating-action-area` which is `position: fixed; bottom: 0;` to ensure it never gets pushed off screen by long transcripts.

## Known Limitations / Edges Cases to Monitor
- iOS WebGPU support is still experimental in some versions of Safari. The `llm.worker.ts` has a `try/catch` block that will return an error status if WebGPU fails to initialize, allowing the app to still function as a transcription-only tool.
