import { pipeline, env } from '@xenova/transformers';

// Disable local model check in browser
env.allowLocalModels = false;
// Deterministic single-thread WASM: WKWebView is not cross-origin isolated,
// and one thread keeps the memory arena as small as possible.
env.backends.onnx.wasm.numThreads = 1;

let transcriberPromise: Promise<any> | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, audio, model, requestId, initId } = e.data;

  try {
    if (type === 'init') {
      self.postMessage({ status: 'progress', progress: 0, initId });
      // Aggregate per-file download progress into one overall percentage,
      // otherwise the bar jumps 0-100 once per model file.
      const files = new Map<string, { loaded: number; total: number }>();
      transcriberPromise = pipeline('automatic-speech-recognition', model || 'Xenova/whisper-tiny.en', {
        progress_callback: (info: any) => {
          if (info.status === 'progress' && info.total) {
            files.set(info.file, { loaded: info.loaded, total: info.total });
            let loaded = 0, total = 0;
            for (const f of files.values()) { loaded += f.loaded; total += f.total; }
            self.postMessage({ status: 'progress', progress: Math.min(99, Math.round((loaded / total) * 100)), initId });
          }
        }
      });
      await transcriberPromise;
      self.postMessage({ status: 'ready', initId });
    }

    if (type === 'transcribe') {
      // Waits if an init is still in flight (e.g. re-warm right after app reload)
      if (!transcriberPromise) throw new Error('Transcriber not initialized');
      const transcriber = await transcriberPromise;
      self.postMessage({ status: 'processing', requestId });

      // Long audio is processed in 20s windows (smaller peak memory than 30s —
      // WKWebView kills the process on OOM); progress posted per window.
      // return_timestamps is REQUIRED for >chunk-length audio: the stitcher
      // aligns windows by timestamp tokens — without it long transcripts
      // collapse to a few words. (language/task omitted: tiny.en is EN-only.)
      const totalChunks = Math.max(1, Math.ceil((audio.length / 16000) / 16));
      let seenChunks = 0;
      const result = await transcriber(audio, {
        chunk_length_s: 20,
        stride_length_s: 4,
        return_timestamps: true,
        chunk_callback: () => {
          seenChunks++;
          self.postMessage({
            status: 'transcribe_progress', requestId,
            current: Math.min(seenChunks, totalChunks),
            total: totalChunks,
          });
        },
      });

      self.postMessage({ status: 'complete', requestId, text: result.text });
    }
  } catch (error: any) {
    self.postMessage({ status: 'error', requestId, initId, operation: type, message: error.message });
  }
};
