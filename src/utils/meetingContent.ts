import { idb } from './idb.ts';
import type { MeetingRecord } from './store.ts';

const transcriptKey = (meetingId: string) => `transcript:${meetingId}`;

export interface TranscriptIntegrity {
  transcriptOutcome: 'text' | 'no_speech';
  transcriptChars: number;
  transcriptBytes: number;
  transcriptChecksum: string;
}

export interface TranscriptStore {
  get<T>(store: 'content', key: string): Promise<T>;
  put(store: 'content', key: string, value: unknown): Promise<unknown>;
  del(store: 'content', key: string): Promise<unknown>;
}

interface TranscriptSequenceOptions {
  signal?: AbortSignal;
  storage?: TranscriptStore;
  maxDurationMs?: number;
  now?: () => number;
  onProgress?: (completed: number, total: number, meeting: MeetingRecord) => void;
}

function assertSequenceActive(
  options: TranscriptSequenceOptions,
  startedAt: number,
  operation: string,
): void {
  if (options.signal?.aborted) {
    throw options.signal.reason instanceof Error
      ? options.signal.reason
      : new Error(`${operation} was canceled.`);
  }
  if (options.maxDurationMs !== undefined &&
      (options.now || Date.now)() - startedAt >= options.maxDurationMs) {
    throw new Error(`${operation} reached its safety time limit. Retry to continue; no saved recording or transcript was changed.`);
  }
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

/** Stable whole-body fingerprint for accidental truncation/corruption detection. */
export function transcriptIntegrity(transcript: string): TranscriptIntegrity {
  const bytes = new TextEncoder().encode(transcript);
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return {
    transcriptOutcome: transcript.length ? 'text' : 'no_speech',
    transcriptChars: transcript.length,
    transcriptBytes: bytes.byteLength,
    transcriptChecksum: `fnv1a64-v1:${hash.toString(16).padStart(16, '0')}`,
  };
}

export function assertTranscriptIntegrity(
  transcript: string,
  expected: Pick<MeetingRecord, 'transcriptOutcome' | 'transcriptChars' | 'transcriptBytes' | 'transcriptChecksum'>,
): TranscriptIntegrity {
  const actual = transcriptIntegrity(transcript);
  const mismatch =
    (expected.transcriptOutcome !== undefined && expected.transcriptOutcome !== actual.transcriptOutcome) ||
    (expected.transcriptChars !== undefined && expected.transcriptChars !== actual.transcriptChars) ||
    (expected.transcriptBytes !== undefined && expected.transcriptBytes !== actual.transcriptBytes) ||
    (expected.transcriptChecksum !== undefined && expected.transcriptChecksum !== actual.transcriptChecksum);
  if (mismatch) {
    throw new Error('Saved transcript integrity check failed. Search, summary, and export stopped rather than using incomplete or altered text. The recording and backup recovery options remain available.');
  }
  return actual;
}

function hasCompleteTextIntegrity(meeting: MeetingRecord): boolean {
  return meeting.transcriptOutcome === 'text' &&
    Number.isSafeInteger(meeting.transcriptChars) && (meeting.transcriptChars || 0) > 0 &&
    Number.isSafeInteger(meeting.transcriptBytes) && (meeting.transcriptBytes || 0) > 0 &&
    typeof meeting.transcriptChecksum === 'string' && meeting.transcriptChecksum.startsWith('fnv1a64-v1:');
}

/** Write the complete transcript before compact metadata is allowed to omit it. */
export async function saveMeetingTranscript(
  meetingId: string,
  transcript: string,
  storage: TranscriptStore = idb,
): Promise<TranscriptIntegrity> {
  if (!transcript.length) throw new Error('An empty transcript is an explicit no-speech outcome and is not archived as text.');
  const integrity = transcriptIntegrity(transcript);
  await storage.put('content', transcriptKey(meetingId), transcript);
  const verified = await storage.get<string>('content', transcriptKey(meetingId));
  if (verified !== transcript) throw new Error('Transcript content verification failed.');
  assertTranscriptIntegrity(verified, integrity);
  return integrity;
}

export async function loadMeetingTranscript(
  meetingId: string,
  expected?: Pick<MeetingRecord, 'transcriptOutcome' | 'transcriptChars' | 'transcriptBytes' | 'transcriptChecksum'>,
  storage: TranscriptStore = idb,
): Promise<string> {
  const transcript = (await storage.get<string>('content', transcriptKey(meetingId))) || '';
  if (expected) assertTranscriptIntegrity(transcript, expected);
  return transcript;
}

export async function deleteMeetingContent(meetingId: string, storage: TranscriptStore = idb): Promise<void> {
  await storage.del('content', transcriptKey(meetingId));
}

/** Keep the synchronous recovery/state-machine record small and quota-safe. */
export function compactMeetingRecords(meetings: MeetingRecord[]): MeetingRecord[] {
  return meetings.map(meeting => meeting.transcriptStored && hasCompleteTextIntegrity(meeting)
    ? { ...meeting, transcript: '' }
    : meeting);
}

export async function hydrateMeetingTranscripts(
  meetings: MeetingRecord[],
  options: TranscriptSequenceOptions & { tolerateArchiveFailure?: boolean } = {},
): Promise<MeetingRecord[]> {
  const storage = options.storage || idb;
  const startedAt = (options.now || Date.now)();
  const hydrated: MeetingRecord[] = [];
  for (const meeting of meetings) {
    assertSequenceActive(options, startedAt, 'Transcript hydration');
    let complete = meeting;
    if (meeting.transcript) {
      const integrity = assertTranscriptIntegrity(meeting.transcript, meeting);
      complete = { ...meeting, ...integrity };
    } else if (!meeting.transcriptStored) {
      if (meeting.transcriptOutcome === 'no_speech') {
        const integrity = assertTranscriptIntegrity('', meeting);
        complete = { ...meeting, ...integrity };
      }
    } else {
      try {
        const transcript = await loadMeetingTranscript(meeting.id, meeting, storage);
        if (transcript) complete = { ...meeting, transcript, ...transcriptIntegrity(transcript) };
      } catch (error) {
        if (!options.tolerateArchiveFailure) throw error;
      }
    }
    assertSequenceActive(options, startedAt, 'Transcript hydration');
    hydrated.push(complete);
    options.onProgress?.(hydrated.length, meetings.length, complete);
  }
  return hydrated;
}

/**
 * Visit verified text transcripts one at a time. Search and semantic indexing
 * can cover a library of hours-long meetings without simultaneously retaining
 * every transcript body or starting hundreds of IndexedDB transactions.
 */
export async function scanVerifiedMeetingTranscripts(
  meetings: MeetingRecord[],
  visit: (meeting: MeetingRecord) => void | Promise<void>,
  options: TranscriptSequenceOptions = {},
): Promise<number> {
  const storage = options.storage || idb;
  const startedAt = (options.now || Date.now)();
  let visited = 0;
  for (let index = 0; index < meetings.length; index++) {
    const meeting = meetings[index];
    assertSequenceActive(options, startedAt, 'Saved transcript scan');

    let complete = meeting;
    if (meeting.transcript) {
      complete = { ...meeting, ...assertTranscriptIntegrity(meeting.transcript, meeting) };
    } else if (meeting.transcriptStored) {
      const transcript = await loadMeetingTranscript(meeting.id, meeting, storage);
      if (!transcript) {
        throw new Error('A saved transcript archive was missing. Search stopped rather than returning incomplete results; the recording and backup recovery options remain available.');
      }
      complete = { ...meeting, transcript, ...transcriptIntegrity(transcript) };
    } else if (meeting.transcriptOutcome === 'no_speech') {
      assertTranscriptIntegrity('', meeting);
      options.onProgress?.(index + 1, meetings.length, meeting);
      continue;
    } else {
      const terminal = !meeting.status || meeting.status === 'complete' || meeting.status === 'done';
      if (terminal) {
        throw new Error('A completed meeting has no verified transcript outcome. Search stopped rather than silently omitting it; recreate the transcript from saved audio or restore a complete backup.');
      }
      options.onProgress?.(index + 1, meetings.length, meeting);
      continue;
    }

    assertSequenceActive(options, startedAt, 'Saved transcript scan');
    if (complete.transcriptOutcome === 'text' && complete.transcript) {
      await visit(complete);
      visited++;
    }
    assertSequenceActive(options, startedAt, 'Saved transcript scan');
    options.onProgress?.(index + 1, meetings.length, complete);
  }
  return visited;
}

/**
 * Archive transcript bodies in a single-file queue. Failed writes keep the
 * complete inline body so a storage outage can never turn an import or legacy
 * migration into data loss.
 */
export async function archiveMeetingTranscriptsSequentially(
  meetings: MeetingRecord[],
  options: TranscriptSequenceOptions & {
    releaseVerifiedBodies?: boolean;
    onArchiveError?: (error: unknown, meeting: MeetingRecord) => void;
  } = {},
): Promise<MeetingRecord[]> {
  const storage = options.storage || idb;
  const startedAt = (options.now || Date.now)();
  const archived = [...meetings];
  for (let index = 0; index < archived.length; index++) {
    assertSequenceActive(options, startedAt, 'Transcript archiving');
    const meeting = archived[index];
    let result = meeting;
    if (meeting.transcript) {
      try {
        const integrity = await saveMeetingTranscript(meeting.id, meeting.transcript, storage);
        result = {
          ...meeting,
          transcript: options.releaseVerifiedBodies ? '' : meeting.transcript,
          transcriptStored: true,
          ...integrity,
        };
      } catch (error) {
        options.onArchiveError?.(error, meeting);
        result = { ...meeting, transcriptStored: false };
      }
    }
    assertSequenceActive(options, startedAt, 'Transcript archiving');
    archived[index] = result;
    options.onProgress?.(index + 1, archived.length, result);
  }
  return archived;
}

/** Prevent a saved-but-untranscribed recording from producing a blank export. */
export function assertMeetingTranscriptExportable(meeting: MeetingRecord): void {
  const complete = !meeting.status || meeting.status === 'complete' || meeting.status === 'done';
  if (complete && (meeting.transcript || meeting.transcriptStored || meeting.transcriptOutcome === 'no_speech')) return;
  if (complete) {
    throw new Error('Export stopped because this completed meeting has no verified transcript or explicit no-speech outcome. Recreate the transcript from saved audio or restore it from a complete backup.');
  }
  throw new Error('Export stopped because transcription is not complete. Resume transcription from History, then export the complete meeting.');
}
