import { CreateMLCEngine } from "@mlc-ai/web-llm";

let enginePromise: Promise<any> | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, text, systemPrompt, requestId, initId } = e.data;

  try {
    if (type === 'init') {
      self.postMessage({ status: 'progress', progress: 0, initId });
      // We use a very small quantized model for mobile browser stability
      enginePromise = CreateMLCEngine("TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC", {
        initProgressCallback: (info) => {
          self.postMessage({ status: 'progress', progress: Math.round(info.progress * 100), initId });
        }
      });
      await enginePromise;
      self.postMessage({ status: 'ready', initId });
    }

    if (type === 'summarize') {
      if (!enginePromise) throw new Error('LLM Engine not initialized');
      const engine = await enginePromise;
      self.postMessage({ status: 'processing', requestId });
      
      const reply = await engine.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt || "You are a professional assistant. Summarize the provided meeting transcript into concise key takeaways and action items." },
          { role: "user", content: text }
        ],
      });
      
      self.postMessage({ status: 'complete', requestId, text: reply.choices[0].message.content });
    }

    if (type === 'chat') {
      if (!enginePromise) throw new Error('LLM Engine not initialized');
      const engine = await enginePromise;
      const reply = await engine.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt || "You are a helpful assistant." },
          { role: "user", content: text }
        ],
      });
      self.postMessage({ status: 'chat_complete', requestId, text: reply.choices[0].message.content });
    }

    if (type === 'autoTitle') {
      if (!enginePromise) throw new Error('LLM Engine not initialized');
      const engine = await enginePromise;
      self.postMessage({ status: 'title_processing', requestId });
      
      const reply = await engine.chat.completions.create({
        messages: [
          { role: "system", content: "You are an assistant. Generate a highly concise 3-5 word title for this meeting based on the transcript. Reply ONLY with the title." },
          { role: "user", content: text }
        ],
      });
      
      self.postMessage({ status: 'title_complete', requestId, text: reply.choices[0].message.content.replace(/["']/g, "").trim() });
    }
  } catch (error: any) {
    // If WebGPU is unsupported (e.g. iOS Safari without flags), this will catch
    self.postMessage({ status: 'error', requestId, initId, operation: type, message: error.message });
  }
};
