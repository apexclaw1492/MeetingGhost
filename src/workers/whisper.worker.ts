import { pipeline, env } from '@xenova/transformers';

// Disable local model check in browser
env.allowLocalModels = false;

let transcriberPromise: Promise<any> | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, audio, model } = e.data;

  try {
    if (type === 'init') {
      self.postMessage({ status: 'progress', progress: 0 });
      // Aggregate per-file download progress into one overall percentage,
      // otherwise the bar jumps 0-100 once per model file.
      const files = new Map<string, { loaded: number; total: number }>();
      transcriberPromise = pipeline('automatic-speech-recognition', model || 'Xenova/whisper-tiny.en', {
        progress_callback: (info: any) => {
          if (info.status === 'progress' && info.total) {
            files.set(info.file, { loaded: info.loaded, total: info.total });
            let loaded = 0, total = 0;
            for (const f of files.values()) { loaded += f.loaded; total += f.total; }
            self.postMessage({ status: 'progress', progress: Math.min(99, Math.round((loaded / total) * 100)) });
          }
        }
      });
      await transcriberPromise;
      self.postMessage({ status: 'ready' });
    }

    if (type === 'transcribe') {
      // Waits if an init is still in flight (e.g. re-warm right after app reload)
      if (!transcriberPromise) throw new Error('Transcriber not initialized');
      const transcriber = await transcriberPromise;
      self.postMessage({ status: 'processing' });
      
      const result = await transcriber(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: 'english',
        task: 'transcribe',
      });
      
      self.postMessage({ status: 'complete', text: result.text });
    }
  } catch (error: any) {
    self.postMessage({ status: 'error', message: error.message });
  }
};
