import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false;

let embedderPromise: Promise<any> | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, texts, requestId } = e.data;

  try {
    if (type === 'init') {
      self.postMessage({ status: 'progress', progress: 0 });
      const files = new Map<string, { loaded: number; total: number }>();
      embedderPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        progress_callback: (info: any) => {
          if (info.status === 'progress' && info.total) {
            files.set(info.file, { loaded: info.loaded, total: info.total });
            let loaded = 0, total = 0;
            for (const f of files.values()) { loaded += f.loaded; total += f.total; }
            self.postMessage({ status: 'progress', progress: Math.min(99, Math.round((loaded / total) * 100)) });
          }
        }
      });
      await embedderPromise;
      self.postMessage({ status: 'ready' });
    }

    if (type === 'embed') {
      if (!embedderPromise) throw new Error('Embedder not initialized');
      const embedder = await embedderPromise;
      const vectors: number[][] = [];
      for (const text of texts as string[]) {
        const output = await embedder(text, { pooling: 'mean', normalize: true });
        vectors.push(Array.from(output.data as Float32Array));
      }
      self.postMessage({ status: 'embedded', requestId, vectors });
    }
  } catch (error: any) {
    self.postMessage({ status: 'error', requestId, message: error.message });
  }
};
