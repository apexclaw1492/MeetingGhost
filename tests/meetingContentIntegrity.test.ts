import test from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveMeetingTranscriptsSequentially,
  assertTranscriptIntegrity,
  hydrateMeetingTranscripts,
  loadMeetingTranscript,
  saveMeetingTranscript,
  scanVerifiedMeetingTranscripts,
  transcriptIntegrity,
} from '../src/utils/meetingContent.ts';
import type { MeetingRecord } from '../src/utils/store.ts';

function memoryTranscriptStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async get<T>(_store: 'content', key: string): Promise<T> { return values.get(key) as T; },
    async put(_store: 'content', key: string, value: unknown): Promise<void> { values.set(key, String(value)); },
    async del(_store: 'content', key: string): Promise<void> { values.delete(key); },
  };
}

const meeting = (patch: Partial<MeetingRecord> = {}): MeetingRecord => ({
  id: 'integrity', date: 'Today', dur: 7200, title: 'Integrity fixture',
  transcript: '', summary: 'Complete summary', status: 'complete',
  ...patch,
});

test('archive round-trip retains complete transcript integrity metadata', async () => {
  const storage = memoryTranscriptStore();
  const transcript = 'Opening section. Middle decision. Final action marker.';
  const integrity = await saveMeetingTranscript('integrity', transcript, storage);
  const [hydrated] = await hydrateMeetingTranscripts([
    meeting({ transcriptStored: true, ...integrity }),
  ], { storage });

  assert.equal(hydrated.transcript, transcript);
  assert.deepEqual(transcriptIntegrity(hydrated.transcript), integrity);
});

test('non-empty truncation and same-length alteration fail closed', async () => {
  const original = 'opening | middle decision | final action';
  const integrity = transcriptIntegrity(original);
  const storage = memoryTranscriptStore({ 'transcript:integrity': original.slice(0, -6) });

  await assert.rejects(
    loadMeetingTranscript('integrity', integrity, storage),
    /integrity check failed/,
    'a shortened but still non-empty archive must not hydrate',
  );

  storage.values.set('transcript:integrity', original.replace('middle', 'muddle'));
  await assert.rejects(
    loadMeetingTranscript('integrity', integrity, storage),
    /integrity check failed/,
    'character counts alone must not authorize altered content',
  );
});

test('legacy archive hydrates once and gains integrity metadata', async () => {
  const transcript = 'legacy complete transcript';
  const storage = memoryTranscriptStore({ 'transcript:integrity': transcript });
  const [hydrated] = await hydrateMeetingTranscripts([
    meeting({ transcriptStored: true }),
  ], { storage });

  assert.equal(hydrated.transcript, transcript);
  assert.equal(hydrated.transcriptOutcome, 'text');
  assert.equal(hydrated.transcriptChars, transcript.length);
  assert.match(hydrated.transcriptChecksum || '', /^fnv1a64-v1:/);
});

test('explicit no-speech is verifiable and missing text is not silently relabeled', () => {
  const silent = transcriptIntegrity('');
  assert.equal(silent.transcriptOutcome, 'no_speech');
  assert.doesNotThrow(() => assertTranscriptIntegrity('', silent));
  assert.throws(
    () => assertTranscriptIntegrity('', { ...silent, transcriptOutcome: 'text' }),
    /integrity check failed/,
  );
});

test('large transcript libraries scan one verified body at a time', async () => {
  const count = 500;
  const values = new Map<string, string>();
  const meetings = Array.from({ length: count }, (_, index) => {
    const transcript = `Meeting ${index} complete transcript${index === count - 1 ? ' final-library-marker' : ''}.`;
    values.set(`transcript:m${index}`, transcript);
    return meeting({ id: `m${index}`, transcriptStored: true, ...transcriptIntegrity(transcript) });
  });
  let activeReads = 0;
  let maxActiveReads = 0;
  let reads = 0;
  const storage = {
    async get<T>(_store: 'content', key: string): Promise<T> {
      reads++;
      activeReads++;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await Promise.resolve();
      activeReads--;
      return values.get(key) as T;
    },
    async put(): Promise<void> {},
    async del(): Promise<void> {},
  };
  const matches: string[] = [];
  const progress: number[] = [];
  const visited = await scanVerifiedMeetingTranscripts(meetings, current => {
    if (current.transcript.includes('final-library-marker')) matches.push(current.id);
  }, { storage, onProgress: completed => progress.push(completed) });

  assert.equal(visited, count);
  assert.equal(reads, count);
  assert.equal(maxActiveReads, 1, 'archive scanning must not hydrate the whole library concurrently');
  assert.deepEqual(matches, [`m${count - 1}`]);
  assert.equal(progress.at(-1), count, 'search progress must reach a visible terminal count');
});

test('library scan fails closed instead of silently omitting a missing archive', async () => {
  const transcript = 'complete archive';
  const storage = memoryTranscriptStore();
  await assert.rejects(
    scanVerifiedMeetingTranscripts([
      meeting({ transcriptStored: true, ...transcriptIntegrity(transcript) }),
    ], () => {}, { storage }),
    /integrity check failed|archive was missing/,
  );
});

test('library scan reaches an absolute deadline instead of looking endless', async () => {
  let now = 0;
  const transcripts = ['first complete transcript', 'second complete transcript'];
  const storage = memoryTranscriptStore(Object.fromEntries(transcripts.map((text, index) => [`transcript:d${index}`, text])));
  const slowStorage = {
    ...storage,
    async get<T>(store: 'content', key: string): Promise<T> {
      now += 3;
      return storage.get<T>(store, key);
    },
  };
  const progress: number[] = [];
  await assert.rejects(
    scanVerifiedMeetingTranscripts(transcripts.map((text, index) => meeting({
      id: `d${index}`,
      transcriptStored: true,
      ...transcriptIntegrity(text),
    })), () => {}, {
      storage: slowStorage,
      maxDurationMs: 5,
      now: () => now,
      onProgress: completed => progress.push(completed),
    }),
    /safety time limit/,
  );
  assert.deepEqual(progress, [1], 'a timed-out scan must not report an unverified terminal item');
});

test('whole-library hydration is sequential and reports progress', async () => {
  const count = 200;
  const values = new Map<string, string>();
  const meetings = Array.from({ length: count }, (_, index) => {
    const transcript = `Hydration transcript ${index}.`;
    values.set(`transcript:h${index}`, transcript);
    return meeting({ id: `h${index}`, transcriptStored: true, ...transcriptIntegrity(transcript) });
  });
  let activeReads = 0;
  let maxActiveReads = 0;
  const storage = {
    async get<T>(_store: 'content', key: string): Promise<T> {
      activeReads++;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await Promise.resolve();
      activeReads--;
      return values.get(key) as T;
    },
    async put(): Promise<void> {},
    async del(): Promise<void> {},
  };
  let completed = 0;
  const hydrated = await hydrateMeetingTranscripts(meetings, {
    storage,
    onProgress: current => { completed = current; },
  });
  assert.equal(hydrated.length, count);
  assert.equal(completed, count);
  assert.equal(maxActiveReads, 1, 'backup hydration must not start every archive read together');
});

test('backup restore archives sequentially and retains any body that could not be stored', async () => {
  const count = 200;
  const meetings = Array.from({ length: count }, (_, index) => meeting({
    id: `a${index}`,
    transcript: `Restored complete transcript ${index}.`,
    transcriptStored: false,
  }));
  const values = new Map<string, string>();
  let activeOperations = 0;
  let maxActiveOperations = 0;
  const failedId = 'a137';
  const storage = {
    async get<T>(_store: 'content', key: string): Promise<T> {
      activeOperations++;
      maxActiveOperations = Math.max(maxActiveOperations, activeOperations);
      await Promise.resolve();
      activeOperations--;
      return values.get(key) as T;
    },
    async put(_store: 'content', key: string, value: unknown): Promise<void> {
      activeOperations++;
      maxActiveOperations = Math.max(maxActiveOperations, activeOperations);
      await Promise.resolve();
      activeOperations--;
      if (key === `transcript:${failedId}`) throw new Error('injected storage outage');
      values.set(key, String(value));
    },
    async del(): Promise<void> {},
  };
  const failures: string[] = [];
  let completed = 0;
  const archived = await archiveMeetingTranscriptsSequentially(meetings, {
    storage,
    releaseVerifiedBodies: true,
    onArchiveError: (_error, current) => failures.push(current.id),
    onProgress: current => { completed = current; },
  });
  assert.equal(maxActiveOperations, 1, 'restore must never archive transcript bodies concurrently');
  assert.equal(completed, count);
  assert.deepEqual(failures, [failedId]);
  assert.equal(archived[0].transcript, '');
  assert.equal(archived[0].transcriptStored, true);
  assert.equal(archived[137].transcript, meetings[137].transcript, 'failed archive must retain the complete inline body');
  assert.equal(archived[137].transcriptStored, false);
});
