# MeetingGhost Gold — Audited Feature Backlog

**Updated:** 2026-07-17 (v12.25). The execution backlog is `.agent/TASKS.md`; this file
retains product ideas and corrects the old implementation status.

This document outlines the strategic roadmap and feature backlog for MeetingGhost Gold, driving development towards an advanced, completely private on-device voice intelligence hub.

---

## 🚀 Version 2.0: Core Experience & Native Mobile Polish
*Focus: Refine the recording experience, native interactions, and storage optimization.*

- [~] **Capacitor Background Recording Lifecycle**
  - iOS AVAudioSession and Android foreground service/wake lock are implemented
    and build-verified; late startup/cancellation races are bounded and native
    memory-pressure/session diagnostics are available, but
    physical lock/hour tests are unproven. Native audio
    capture itself remains P0; see `.agent/RELIABILITY_OPTIONS.md`.
- [x] **Audio Waveform Customization**
  - Implement a real-time Canvas-based audio visualizer reading from `AudioContext` instead of simulated styling bars.
- [ ] **Adaptive Storage Manager**
  - Add settings to change recording audio quality (e.g., sample rate, bit rate, mono vs. stereo) and export formats (`wav`, `mp3`, `m4a`) to optimize on-device storage.
- [x] **Haptic Feedback Integration**
  - Start/stop haptics are implemented as optional bounded side effects; they
    cannot delay microphone acquisition or finalization.

---

## 🧠 Version 3.0: True On-Device AI Pipeline
*Focus: Transition from simulated outputs to true local browser & native speech-to-text.*

- [x] **WebAssembly Whisper Integration**
  - Integrate Whisper.onnx or whisper.cpp via WebAssembly for running voice-to-text speech processing fully locally in the browser/PWA.
- [~] **Capacitor Native ML Core**
  - iOS uses native Apple Speech. Android 13+ has support-checked native
    saved-audio speech with a bounded Whisper compatibility fallback. Both
    Android paths remain physically unqualified.
- [x] **Local Summarizer Integration**
  - TinyLlama/WebLLM refinement exists where WebGPU is available. A deterministic
    structured fallback now guarantees summaries without the model.
- [ ] **Language Auto-Detection**
  - Support automatic language detection for multi-lingual meeting transcription.

---

## 📂 Version 4.0: Intelligence, Search & Local Sync
*Focus: Smart categorization, offline search, and device-to-device secure data sharing.*

- [x] **Local Vector Database & Semantic Search**
  - IndexedDB stores local embeddings for natural-language retrieval. v12.25
    binds each envelope to exact transcript integrity/chunks/model schema,
    rebuilds stale or corrupt records, bulk-checks freshness, and gives long
    indexing jobs progress, Cancel, a hard deadline, and resumable verified
    commits while preserving full-text search. Archived transcripts are scanned
    one at a time and loaded into History only on demand, so large libraries do
    not require every hours-long body in WebView memory.
- [ ] **Automated Speaker Diarization**
  - Identify different voices ("Speaker 1", "Speaker 2") during recording using local speaker identification models.
- [ ] **P2P Encrypted Local Sync**
  - Enable local sync between PWA, iOS, and Android devices using WebRTC/Local network broadcasts without ever uploading data to a central cloud server.
- [~] **Automatic Backup & Restore**
  - Allow encrypted export of the entire local database to private storage (e.g., iCloud Drive, Google Drive).

---

## 🏆 Version 5.0: Enterprise Voice Hub & Platform Integration
*Focus: Seamless integration into business workflows and advanced OS features.*

- [~] **Action Item Integrations**
  - GitHub Issues, Calendar, Email, and complete native sharing are implemented.
    Jira, Linear, and Trello are not implemented.
- [ ] **iOS Live Activities & Android Notification Controls**
  - Add native lockscreen widget status showing live recording elapsed time and current speaker state.
- [ ] **Voice-to-Text Custom Vocabulary**
  - Allow users to train local models on custom acronyms, names, and industry-specific jargon to boost word accuracy.
- [~] **Smart Playback Engine**
  - Implement skip-silence, speed adjustment (0.5x to 2.5x), and audio enhancement filters for meeting playback.

Legend: `[x]` implemented, `[~]` partial or not physically qualified, `[ ]`
not implemented. Reliability P0 work takes precedence over unchecked product
features.
