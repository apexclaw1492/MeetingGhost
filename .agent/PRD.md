# Product Requirements Document (PRD)
**Project:** MeetingGhost Gold
**Vision:** A premium, hyper-secure meeting transcription and summarization hub that runs 100% locally on-device. No cloud APIs, no subscriptions, total privacy.

## Core Value Proposition
- **Total Privacy:** Audio is processed directly on the user's hardware.
- **Ultra-Light Initial Install:** The core app is ~3MB. Heavy AI models are downloaded post-installation as needed.
- **Premium Aesthetic:** Designed with a brushed gold and obsidian black theme, targeting a luxurious, professional user experience (similar to premium fintech apps).

## Target Platforms
1. **iOS / Android (Capacitor Native):** Primary target. The UI must accommodate native constraints (e.g., `100dvh` for iOS Safari bottom bars, safe-area-insets).
2. **PWA (Web):** Full offline functionality in modern web browsers using WebAssembly and WebGPU.

## Key Features (Implemented)
- **Local Voice-to-Text:** Uses `@xenova/transformers` (Whisper) via WebAssembly.
- **Local AI Summarization:** Uses `@mlc-ai/web-llm` (TinyLlama) via WebGPU.
- **Auto-Titling:** LLM automatically generates concise meeting titles.
- **Audio File Import:** Users can upload existing `.wav`, `.mp3`, or `.m4a` files for processing.
- **Exporting Options:** PDF, Markdown (.md), and standard native sharing capabilities.
- **History Management:** Real-time search by title and transcript, and persistent local storage (`localStorage`).

## UX / UI Principles
- **Aesthetic:** Dark mode only. `var(--bg-void)` (#020304) base with `var(--gold-gradient)` accents. 
- **Frameworks:** No Tailwind. Pure custom CSS (`App.css`) for maximum flexibility and adherence to the premium metal aesthetic.
- **Layout:** The main "Record" button must *always* be visible. Use a floating action area pinned to the bottom of the screen.

## AI Model Constraints
- **Resource Management:** Loading 250MB+ models in a mobile Safari tab requires careful memory management. Use Web Workers exclusively to prevent main thread freezing.
- **Graceful Degradation:** If WebGPU is unavailable (e.g., older iOS), summarization must fail gracefully without breaking the core transcription engine.
