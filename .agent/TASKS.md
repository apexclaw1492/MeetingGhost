# Task Backlog (To-Do List)
*For the incoming agent. Start executing these tasks directly to build out v5.0+.*

## High Priority: The Organization & Advanced AI Bundle
- [ ] **Feature 1: Keyword Highlighting & Search inside transcripts.**
  - **Details:** Add a UI toggle to highlight critical words (e.g., "Action", "Follow up", "Deadline") directly inside the `transcript-panel`.
- [ ] **Feature 2: Language Translation.**
  - **Details:** Use `@xenova/transformers` translation models to add a "Translate to Spanish/French" button to the transcript UI.
- [ ] **Feature 3: Folder Organization.**
  - **Details:** Update the `MeetingRecord` interface to include a `folderId`. Add a UI in the History tab to create folders and move meetings into them.
- [ ] **Feature 4: Cloud Sync.**
  - **Details:** Integrate a basic mechanism to export the entire `localStorage` DB to a JSON file, and allow importing from a JSON file.
- [ ] **Feature 5: Advanced Audio Visualizer Themes.**
  - **Details:** Update the `drawWaveform` function in `App.tsx` to allow users to toggle between different visualizations (Waveform, Circular, Bars).

## Medium Priority: Performance & Polish
- [ ] **Capacitor Background Recording Service:**
  - Ensure recording continues when the iOS/Android app is minimized using native plugins (`@capacitor-community/background-geolocation` or similar audio hooks).
- [ ] **Automated Speaker Diarization:**
  - Attempt to identify different voices ("Speaker 1", "Speaker 2") during recording, though this is difficult with local browser models. May require a separate lightweight ONNX model.
