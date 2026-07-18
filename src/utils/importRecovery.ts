import type { StoredAudioManifest } from './audioStore.ts';
import type { MeetingRecord } from './store.ts';

/**
 * A native import can finish its atomic rename just before the bridge callback
 * times out. In that race the protected file is authoritative: retain it and
 * surface a retryable meeting instead of deleting verified audio.
 */
export function recoveredImportPatch(
  meetingId: string,
  manifests: StoredAudioManifest[],
  originalError: string,
): Partial<MeetingRecord> | null {
  const manifest = manifests.find(candidate => candidate.meetingId === meetingId);
  if (!manifest?.segmentIds.length) return null;
  return {
    status: 'transcription_interrupted',
    audioKind: 'segments',
    segments: manifest.segmentIds.length,
    segmentIds: [...manifest.segmentIds],
    bytes: manifest.totalBytes,
    diag: `The import result was interrupted (${originalError}), but ${manifest.segmentIds.length} verified audio file${manifest.segmentIds.length === 1 ? '' : 's'} remained in protected storage. Tap Transcribe Audio to continue.`,
  };
}
