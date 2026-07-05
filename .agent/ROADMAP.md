# MeetingGhost Gold — Roadmap

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

## 🧠 Future Visions: v10+
- **Capacitor Background Recording Service:** keep recording while the app is minimized (AVAudioSession / ForegroundService).
- **Speaker Diarization:** local voice separation ("Speaker 1/2") via a dedicated ONNX model.
- **Live transcription preview:** stream partial transcripts while recording.
- **Translation:** on-demand opus-mt models (Spanish/French).
- **P2P Encrypted Local Sync:** WebRTC sync between devices, no cloud.
- **Capacitor Native ML Core:** CoreML / NNAPI for native-speed transcription.
