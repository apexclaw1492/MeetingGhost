import { pipeline, env } from '@xenova/transformers';

// Disable local model check in browser
env.allowLocalModels = false;

let transcriber: any = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, audio, model } = e.data;

  try {
    if (type === 'init') {
      self.postMessage({ status: 'progress', progress: 0 });
      transcriber = await pipeline('automatic-speech-recognition', model || 'Xenova/whisper-tiny.en', {
        progress_callback: (info: any) => {
          if (info.status === 'progress') {
            // Transform 0-100 to progress percentage
            self.postMessage({ status: 'progress', progress: Math.round(info.progress) });
          }
        }
      });
      self.postMessage({ status: 'ready' });
    }

    if (type === 'transcribe') {
      if (!transcriber) throw new Error('Transcriber not initialized');
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
