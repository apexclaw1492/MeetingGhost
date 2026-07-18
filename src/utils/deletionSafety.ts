import { withTimeout } from './async.ts';

export interface MeetingDeletionOperations {
  deleteAudio: () => Promise<void>;
  deleteTranscript: () => Promise<void>;
  deleteSearchIndex: () => Promise<void>;
}

export async function deleteMeetingArtifacts(
  operations: MeetingDeletionOperations,
  timeoutMs = 60_000,
): Promise<void> {
  const results = await Promise.allSettled([
    withTimeout(operations.deleteAudio(), timeoutMs, 'Audio deletion timed out.'),
    withTimeout(operations.deleteTranscript(), timeoutMs, 'Transcript deletion timed out.'),
    withTimeout(operations.deleteSearchIndex(), timeoutMs, 'Search-index deletion timed out.'),
  ]);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason));
  if (failures.length) throw new Error(failures.join(' '));
}
