# Task Backlog (To-Do List)

## In Flight: v5.0 — v9.0 (competing with MeetGeek)
Strategy agreed with owner (2026-07-05): blend the original backlog with MeetGeek-competitive
features; stay local-first but add an optional bring-your-own-key Claude API tier; verify each
version with web build + preview test + `cap sync` + Gradle + xcodebuild; one commit per version.

- [x] **v5.0 Organization & Search** — shipped (commit ca25235).
- [x] **v6.0 Meeting Intelligence** — shipped (commit 235560b).
- [x] **v7.0 Semantic Search & Chat** — shipped (commit 7922235).
- [x] **v8.0 Integrations & Sharing** — shipped (commit 7df3310).
- [x] **v9.0 Playback & Polish** — audio playback (owner chose this over live
      transcription/translation for v9), README + docs refresh.

## Done in v4.1 (2026-07-05)
- [x] Workers re-warm after reload (previously: models "Installed" but transcription dead).
- [x] Init queuing inside both workers (transcribe/summarize wait for in-flight init).
- [x] Aggregated Whisper download progress (was jumping 0-100 per file).
- [x] WebGPU detection surfaced in Models tab; summarizer download blocked when unsupported.
- [x] Empty-transcript guard ("No speech detected") instead of hanging the pipeline.
- [x] StrictMode double-save fix; stale-closure fix in process().

## Medium Priority (unscheduled)
- [ ] **Capacitor Background Recording Service:** keep recording when the app is minimized
      (native AVAudioSession / ForegroundService work).
- [ ] **Automated Speaker Diarization:** local voice separation, likely needs a dedicated ONNX model.
- [ ] **Capacitor Native ML Core:** CoreML / NNAPI transcription for native speed.
