# MeetingGhost Gold — Roadmap & Backlog (through v5.0)

This document outlines the strategic roadmap and feature backlog for MeetingGhost Gold, driving development towards an advanced, completely private on-device voice intelligence hub.

---

## 🚀 Version 2.0: Core Experience & Native Mobile Polish
*Focus: Refine the recording experience, native interactions, and storage optimization.*

- [ ] **Capacitor Background Recording Service**
  - Implement native background audio recording listeners for iOS (`AVAudioSession`) and Android (`ForegroundService`) so recording doesn't stop when the app is minimized or the screen turns off.
- [ ] **Audio Waveform Customization**
  - Implement a real-time Canvas-based audio visualizer reading from `AudioContext` instead of simulated styling bars.
- [ ] **Adaptive Storage Manager**
  - Add settings to change recording audio quality (e.g., sample rate, bit rate, mono vs. stereo) and export formats (`wav`, `mp3`, `m4a`) to optimize on-device storage.
- [ ] **Haptic Feedback Integration**
  - Use `@capacitor/haptic` to trigger premium physical clicks on the golden mic button for record start/stop events.

---

## 🧠 Version 3.0: True On-Device AI Pipeline
*Focus: Transition from simulated outputs to true local browser & native speech-to-text.*

- [ ] **WebAssembly Whisper Integration**
  - Integrate Whisper.onnx or whisper.cpp via WebAssembly for running voice-to-text speech processing fully locally in the browser/PWA.
- [ ] **Capacitor Native ML Core**
  - Integrate Apple CoreML (on iOS) and Android NNAPI (on Android) to run speech models directly on modern NPUs for ultra-fast local transcriptions.
- [ ] **Gemma 3 Local Summarizer Integration**
  - Integrate local LLM execution via WebLLM or MLC-LLM to run Gemma 3 (or Llama 3 8B) locally on GPU/NPU for summary generation.
- [ ] **Language Auto-Detection**
  - Support automatic language detection for multi-lingual meeting transcription.

---

## 📂 Version 4.0: Intelligence, Search & Local Sync
*Focus: Smart categorization, offline search, and device-to-device secure data sharing.*

- [ ] **Local Vector Database & Semantic Search**
  - Implement an on-device vector DB (e.g., Voy or Orama) utilizing local embeddings so users can ask natural language questions about past meetings.
- [ ] **Automated Speaker Diarization**
  - Identify different voices ("Speaker 1", "Speaker 2") during recording using local speaker identification models.
- [ ] **P2P Encrypted Local Sync**
  - Enable local sync between PWA, iOS, and Android devices using WebRTC/Local network broadcasts without ever uploading data to a central cloud server.
- [ ] **Automatic Backup & Restore**
  - Allow encrypted export of the entire local database to private storage (e.g., iCloud Drive, Google Drive).

---

## 🏆 Version 5.0: Enterprise Voice Hub & Platform Integration
*Focus: Seamless integration into business workflows and advanced OS features.*

- [ ] **Action Item Integrations**
  - Automatically format extracted action items and export them directly to Jira, GitHub Issues, Linear, or Trello via API.
- [ ] **iOS Live Activities & Android Notification Controls**
  - Add native lockscreen widget status showing live recording elapsed time and current speaker state.
- [ ] **Voice-to-Text Custom Vocabulary**
  - Allow users to train local models on custom acronyms, names, and industry-specific jargon to boost word accuracy.
- [ ] **Smart Playback Engine**
  - Implement skip-silence, speed adjustment (0.5x to 2.5x), and audio enhancement filters for meeting playback.
