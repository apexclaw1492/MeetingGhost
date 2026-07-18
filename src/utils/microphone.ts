import { withTimeout } from './async.ts';

/**
 * Bound microphone acquisition without leaking a stream that resolves after
 * the UI has already reported timeout. The browser permission prompt itself
 * cannot be aborted portably, so any late stream is immediately stopped.
 */
export async function acquireMicrophoneStream(
  request: Promise<MediaStream>,
  timeoutMs = 30_000,
): Promise<MediaStream> {
  try {
    return await withTimeout(
      request,
      timeoutMs,
      `Microphone access did not complete within ${Math.ceil(timeoutMs / 1000)} seconds. Check the permission prompt and try again.`,
    );
  } catch (error) {
    void request.then(stream => {
      stream.getTracks().forEach(track => track.stop());
    }).catch(() => { /* the original rejection is already surfaced */ });
    throw error;
  }
}
