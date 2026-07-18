/** Find the last trustworthy contiguous checkpoint. Empty strings are valid. */
export function safeResumeIndex(parts: string[], requested: number, total: number): number {
  const checkpoint = Math.min(Math.max(0, requested), Math.max(0, total));
  let next = 0;
  while (next < checkpoint && Object.prototype.hasOwnProperty.call(parts, next)) next++;
  return next;
}

/** Assemble only when every expected segment has an explicit transcript entry. */
export function assembleTranscriptParts(parts: string[], total: number): string {
  for (let index = 0; index < total; index++) {
    if (!Object.prototype.hasOwnProperty.call(parts, index)) {
      throw new Error(`Transcript checkpoint is missing segment ${index + 1} of ${total}.`);
    }
  }
  return parts.slice(0, total).join(' ').replace(/\s{2,}/g, ' ').trim();
}

export type TranscriptionStartGate = 'missing_audio' | 'queue' | 'model_unavailable' | 'start';

/** Fail over only when the OS engine is structurally unavailable, not on a transient busy/timeout. */
export function isPermanentNativeEngineFailure(message: string): boolean {
  return /unavailable|not installed|does not support verified saved-audio|rejected verified file-audio/i.test(message);
}

/** Centralize every preflight exit so callers cannot accidentally leave a spinner active. */
export function transcriptionStartGate({
  hasAudio,
  anotherTranscriptionActive,
  nativeEngineAvailable,
  whisperReady,
}: {
  hasAudio: boolean;
  anotherTranscriptionActive: boolean;
  nativeEngineAvailable: boolean;
  whisperReady: boolean;
}): TranscriptionStartGate {
  if (!hasAudio) return 'missing_audio';
  if (anotherTranscriptionActive) return 'queue';
  if (!nativeEngineAvailable && !whisperReady) return 'model_unavailable';
  return 'start';
}
