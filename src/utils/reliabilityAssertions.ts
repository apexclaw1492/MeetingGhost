import type { MeetingRecord } from './store.ts';

export interface ReliabilityAssertion {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ReliabilitySnapshot {
  version: 1;
  totals: {
    meetings: number;
    complete: number;
    nonterminal: number;
    resumableFailure: number;
    recoveryRequired: number;
  };
  assertions: ReliabilityAssertion[];
}

const resumableStatuses = new Set(['saved', 'queued', 'transcription_interrupted', 'transcription_failed']);
const nonterminalStatuses = new Set(['recording', 'queued', 'transcribing', 'processing']);

function exactManifest(meeting: MeetingRecord): boolean {
  if (meeting.audioKind !== 'segments' && !meeting.segments && !meeting.segmentIds?.length) return true;
  const ids = meeting.segmentIds || [];
  if (ids.length !== (meeting.segments || 0)) return false;
  return ids.every((id, index) => Number.isSafeInteger(id) && id >= 0 && (index === 0 || id > ids[index - 1]));
}

function prefixIsDurable(parts: string[] | undefined, next: number): boolean {
  if (next === 0) return true;
  if (!parts || parts.length < next) return false;
  for (let index = 0; index < next; index++) {
    // Empty strings are valid silent-audio checkpoints; sparse array holes are not.
    if (!(index in parts) || typeof parts[index] !== 'string') return false;
  }
  return true;
}

function checkpointIsValid(meeting: MeetingRecord): boolean {
  const total = Math.max(0, meeting.segments || meeting.segmentIds?.length || 0);
  const next = meeting.tNext ?? 0;
  if (!Number.isSafeInteger(next) || next < 0 || next > total || !prefixIsDurable(meeting.tParts, next)) return false;

  const hasSubCheckpoint = meeting.tSubSegment !== undefined || meeting.tSubNext !== undefined ||
    meeting.tSubTotal !== undefined || meeting.tSubParts !== undefined;
  if (!hasSubCheckpoint) return true;
  const subSegment = meeting.tSubSegment;
  const subNext = meeting.tSubNext;
  const subTotal = meeting.tSubTotal;
  if (!Number.isSafeInteger(subSegment) || subSegment !== next ||
      !Number.isSafeInteger(subNext) || !Number.isSafeInteger(subTotal) ||
      (subNext as number) < 0 || (subTotal as number) <= 0 || (subNext as number) > (subTotal as number)) return false;
  return prefixIsDurable(meeting.tSubParts, subNext as number);
}

function hasSavedAudio(meeting: MeetingRecord): boolean {
  return (meeting.segments || meeting.segmentIds?.length || 0) > 0 && (meeting.bytes || 0) > 0;
}

function hasCompleteTranscriptIntegrity(meeting: MeetingRecord): boolean {
  if (meeting.transcriptOutcome === 'no_speech') {
    return !meeting.transcript && meeting.transcriptStored !== true &&
      meeting.transcriptChars === 0 && meeting.transcriptBytes === 0 &&
      typeof meeting.transcriptChecksum === 'string' && meeting.transcriptChecksum.startsWith('fnv1a64-v1:');
  }
  return meeting.transcriptOutcome === 'text' && !!(meeting.transcript || meeting.transcriptStored) &&
    Number.isSafeInteger(meeting.transcriptChars) && (meeting.transcriptChars || 0) > 0 &&
    Number.isSafeInteger(meeting.transcriptBytes) && (meeting.transcriptBytes || 0) > 0 &&
    typeof meeting.transcriptChecksum === 'string' && meeting.transcriptChecksum.startsWith('fnv1a64-v1:');
}

/**
 * Produces content-free assertions for support and release qualification.
 * These are deliberately stricter than the UI: an old count-only manifest or
 * sparse checkpoint is reported instead of being silently treated as proof.
 */
export function buildReliabilitySnapshot(meetings: MeetingRecord[]): ReliabilitySnapshot {
  // Legacy v9 records without a status are treated as complete everywhere in
  // the export path, so diagnostics must audit them with the same strictness.
  const complete = meetings.filter(meeting => !meeting.status || meeting.status === 'complete' || meeting.status === 'done');
  const nonterminal = meetings.filter(meeting => nonterminalStatuses.has(meeting.status || ''));
  const resumableFailure = meetings.filter(meeting => resumableStatuses.has(meeting.status || ''));
  const recoveryRequired = meetings.filter(meeting => meeting.status === 'recovery_required');
  const manifestFailures = meetings.filter(meeting => !exactManifest(meeting));
  const checkpointFailures = meetings.filter(meeting => !checkpointIsValid(meeting));
  const unsafeFailures = resumableFailure.filter(meeting => !hasSavedAudio(meeting));
  const missingSummaries = complete.filter(meeting =>
    !!(meeting.transcript || meeting.transcriptStored) && !meeting.summary?.trim());
  const unavailableTranscripts = complete.filter(meeting =>
    !meeting.transcript && meeting.transcriptStored !== true && meeting.transcriptOutcome !== 'no_speech');
  const transcriptIntegrityFailures = complete.filter(meeting => !hasCompleteTranscriptIntegrity(meeting));

  return {
    version: 1,
    totals: {
      meetings: meetings.length,
      complete: complete.length,
      nonterminal: nonterminal.length,
      resumableFailure: resumableFailure.length,
      recoveryRequired: recoveryRequired.length,
    },
    assertions: [
      {
        name: 'exact_segment_manifests',
        passed: manifestFailures.length === 0,
        detail: manifestFailures.length ? `${manifestFailures.length} meeting(s) have an incomplete or invalid exact segment manifest.` : 'Every segmented recording has a sorted, unique, exact manifest.',
      },
      {
        name: 'durable_resume_checkpoints',
        passed: checkpointFailures.length === 0,
        detail: checkpointFailures.length ? `${checkpointFailures.length} meeting(s) have an out-of-range or sparse transcription checkpoint.` : 'Every transcription checkpoint has a complete durable prefix and valid bounds.',
      },
      {
        name: 'resumable_failures_retain_audio',
        passed: unsafeFailures.length === 0,
        detail: unsafeFailures.length ? `${unsafeFailures.length} resumable meeting state(s) do not retain a non-empty saved-audio manifest.` : 'Every saved, queued, interrupted, or failed transcription retains verified audio metadata.',
      },
      {
        name: 'complete_transcripts_available',
        passed: unavailableTranscripts.length === 0,
        detail: unavailableTranscripts.length ? `${unavailableTranscripts.length} completed meeting(s) have no available or archived transcript outcome.` : 'Every completed meeting has an inline, archived, or explicit no-speech transcript outcome.',
      },
      {
        name: 'complete_transcript_integrity',
        passed: transcriptIntegrityFailures.length === 0,
        detail: transcriptIntegrityFailures.length ? `${transcriptIntegrityFailures.length} completed meeting(s) lack a complete text fingerprint or explicit verified no-speech outcome.` : 'Every completed meeting has durable whole-transcript integrity metadata or an explicit verified no-speech outcome.',
      },
      {
        name: 'complete_meetings_summarized',
        passed: missingSummaries.length === 0,
        detail: missingSummaries.length ? `${missingSummaries.length} completed non-empty transcript(s) are missing a summary.` : 'Every completed non-empty transcript has a saved summary.',
      },
      {
        name: 'no_nonterminal_states_at_export',
        passed: nonterminal.length === 0,
        detail: nonterminal.length ? `${nonterminal.length} meeting(s) are currently recording, queued, transcribing, or processing.` : 'No meeting is in a nonterminal processing state.',
      },
    ],
  };
}

/** Metadata only: never returns title, transcript, summary, or action-item text. */
export function diagnosticMeetingMetadata(meeting: MeetingRecord): Record<string, unknown> {
  return {
    id: meeting.id,
    status: meeting.status,
    dur: meeting.dur,
    bytes: meeting.bytes,
    audioKind: meeting.audioKind,
    segments: meeting.segments,
    segmentIds: meeting.segmentIds,
    failedOrRecovered: meeting.recovered === true,
    retries: meeting.retries,
    tNext: meeting.tNext,
    checkpointParts: meeting.tParts?.filter((_, index) => index in (meeting.tParts || [])).length,
    tSubSegment: meeting.tSubSegment,
    tSubNext: meeting.tSubNext,
    tSubTotal: meeting.tSubTotal,
    subCheckpointParts: meeting.tSubParts?.filter((_, index) => index in (meeting.tSubParts || [])).length,
    lastError: meeting.diag,
    hasTranscript: !!meeting.transcript?.length,
    transcriptStored: meeting.transcriptStored === true,
    transcriptOutcome: meeting.transcriptOutcome,
    transcriptChars: meeting.transcriptChars,
    transcriptBytes: meeting.transcriptBytes,
    transcriptChecksumPresent: typeof meeting.transcriptChecksum === 'string',
    hasSummary: !!meeting.summary?.length,
    actionItemCount: meeting.actionItems?.length || 0,
  };
}
