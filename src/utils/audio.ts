export async function getAudioData(blobs: Blob[], targetSampleRate: number = 16000): Promise<Float32Array> {
  if (blobs.length === 0) {
    throw new Error("No audio blobs provided.");
  }
  
  const blob = new Blob(blobs, { type: blobs[0].type });
  const arrayBuffer = await blob.arrayBuffer();

  // Create temporary context to decode the original audio data
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  // Use OfflineAudioContext to resample it to the target sample rate (e.g., 16kHz for Whisper)
  const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(
    1, // mono
    audioBuffer.duration * targetSampleRate,
    targetSampleRate
  );

  const bufferSource = offlineCtx.createBufferSource();
  bufferSource.buffer = audioBuffer;
  bufferSource.connect(offlineCtx.destination);
  bufferSource.start();

  const renderedBuffer = await offlineCtx.startRendering();
  
  // Clean up original context
  if (ctx.state !== 'closed') {
    await ctx.close();
  }
  
  return renderedBuffer.getChannelData(0);
}
