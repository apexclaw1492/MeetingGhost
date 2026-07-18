export interface AudioChunkRange {
  start: number;
  end: number;
}

export interface AudioTimeChunkRange {
  startMs: number;
  durationMs: number;
}

/** Contiguous, lossless sample ranges for bounded inference requests. */
export function audioChunkRanges(totalSamples: number, maxChunkSamples: number): AudioChunkRange[] {
  const total = Math.max(0, Math.floor(totalSamples));
  const size = Math.floor(maxChunkSamples);
  if (total === 0) return [];
  if (size <= 0) throw new Error('Audio inference chunk size must be positive.');
  const ranges: AudioChunkRange[] = [];
  for (let start = 0; start < total; start += size) {
    ranges.push({ start, end: Math.min(total, start + size) });
  }
  return ranges;
}

/** Contiguous millisecond ranges for native streaming decode/checkpointing. */
export function audioTimeChunkRanges(totalDurationMs: number, maxChunkMs: number): AudioTimeChunkRange[] {
  const total = Math.max(0, Math.ceil(totalDurationMs));
  const size = Math.floor(maxChunkMs);
  if (total === 0) return [];
  if (size <= 0) throw new Error('Native audio decode chunk size must be positive.');
  const ranges: AudioTimeChunkRange[] = [];
  for (let startMs = 0; startMs < total; startMs += size) {
    ranges.push({ startMs, durationMs: Math.min(size, total - startMs) });
  }
  return ranges;
}
