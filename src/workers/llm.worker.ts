import { CreateMLCEngine } from "@mlc-ai/web-llm";

let engine: any = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, text } = e.data;

  try {
    if (type === 'init') {
      self.postMessage({ status: 'progress', progress: 0 });
      // We use a very small quantized model for mobile browser stability
      engine = await CreateMLCEngine("TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC", {
        initProgressCallback: (info) => {
          self.postMessage({ status: 'progress', progress: Math.round(info.progress * 100) });
        }
      });
      self.postMessage({ status: 'ready' });
    }

    if (type === 'summarize') {
      if (!engine) throw new Error('LLM Engine not initialized');
      self.postMessage({ status: 'processing' });
      
      const reply = await engine.chat.completions.create({
        messages: [
          { role: "system", content: "You are a professional assistant. Summarize the provided meeting transcript into concise key takeaways and action items." },
          { role: "user", content: text }
        ],
      });
      
      self.postMessage({ status: 'complete', text: reply.choices[0].message.content });
    }
  } catch (error: any) {
    // If WebGPU is unsupported (e.g. iOS Safari without flags), this will catch
    self.postMessage({ status: 'error', message: error.message });
  }
};
