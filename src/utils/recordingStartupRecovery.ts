import type { RecorderStopResult } from './recorder.ts';
import type { StoredAudioManifest } from './audioStore.ts';
import type { MeetingRecord } from './store.ts';

export type RecordingStartupRecovery =
  | { kind: 'recovered'; patch: Partial<MeetingRecord> }
  | { kind: 'empty' }
  | { kind: 'uncertain'; patch: Partial<MeetingRecord> };

/**
 * Decide a timed-out recorder start without guessing. A verified stop result
 * or authoritative storage manifest may preserve audio. Only agreement between
 * a completed stop and completed scan can prove that no audio exists.
 */
export function recordingStartupRecovery(
  meetingId: string,
  stopped: RecorderStopResult | null,
  manifests: StoredAudioManifest[] | null,
  reason: string,
): RecordingStartupRecovery {
  const manifest = manifests?.find(item => item.meetingId === meetingId);
  const ids = Array.from(new Set([
    ...(stopped?.segmentIds || []),
    ...(manifest?.segmentIds || []),
  ].filter(Number.isInteger))).sort((a, b) => a - b);

  if (ids.length) {
    return {
      kind: 'recovered',
      patch: {
        status: 'transcription_interrupted',
        audioKind: 'segments',
        segments: ids.length,
        segmentIds: ids,
        bytes: Math.max(stopped?.totalBytes || 0, manifest?.totalBytes || 0),
        dur: Math.round((stopped?.recordedMs || 0) / 1000),
        mimeType: stopped?.mimeType || 'audio/mp4',
        diag: `${reason} Recording startup was stopped safely and ${ids.length} verified audio segment${ids.length === 1 ? '' : 's'} were recovered. Tap Retry Transcription.`,
      },
    };
  }

  if (stopped && manifests) return { kind: 'empty' };

  return {
    kind: 'uncertain',
    patch: {
      status: 'recovery_required',
      diag: `${reason} Recorder shutdown or protected-storage verification did not complete. Reopen the app to reconcile recovery; no recording data was deleted.`,
    },
  };
}
