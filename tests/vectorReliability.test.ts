import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertEmbeddingBatch,
  chunkTranscript,
  cosine,
  indexableMeetingCount,
  indexedMeetingIds,
  isValidChunkSet,
  isValidMeetingVectorIndex,
  isValidVector,
  meetingVectorIndexMatches,
  saveMeetingVectors,
  searchVectors,
} from '../src/utils/vectors.ts';
import { transcriptIntegrity } from '../src/utils/meetingContent.ts';
import { SEMANTIC_INDEX_SCHEMA } from '../src/utils/semanticIndexSchema.ts';
import type { MeetingRecord } from '../src/utils/store.ts';

function memoryVectorStore(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  let getCalls = 0;
  let getAllCalls = 0;
  return {
    values,
    stats: () => ({ getCalls, getAllCalls }),
    async get<T>(_store: 'vectors', key: string): Promise<T> { getCalls++; return values.get(key) as T; },
    async put(_store: 'vectors', key: string, value: unknown): Promise<void> { values.set(key, value); },
    async del(_store: 'vectors', key: string): Promise<void> { values.delete(key); },
    async keys(): Promise<string[]> { return [...values.keys()]; },
    async getAll<T>(): Promise<T[]> { getAllCalls++; return [...values.values()] as T[]; },
  };
}

function indexedMeeting(id: string, transcript: string): MeetingRecord {
  return {
    id, date: 'Today', dur: 60, title: id, transcript, summary: 'Summary',
    status: 'complete', ...transcriptIntegrity(transcript),
  };
}

function embeddedChunks(transcript: string) {
  return chunkTranscript(transcript).map((text, chunkIndex) => ({
    text, chunkIndex, vector: chunkIndex % 2 ? [0, 1] : [1, 0],
  }));
}

test('embedding validation rejects missing, malformed, and mixed-dimension results', () => {
  assert.throws(() => assertEmbeddingBatch([[1, 0]], 2), /1\/2 embeddings/);
  assert.throws(() => assertEmbeddingBatch([[1, 0], [Number.NaN, 1]], 2), /malformed or inconsistent/);
  assert.throws(() => assertEmbeddingBatch([[1, 0], [1, 0, 0]], 2), /malformed or inconsistent/);
});

test('embedding validation enforces one dimension across multi-batch indexing', () => {
  const dimension = assertEmbeddingBatch([[1, 0], [0, 1]], 2);
  assert.equal(dimension, 2);
  assert.throws(() => assertEmbeddingBatch([[1, 0, 0]], 1, dimension), /malformed or inconsistent/);
});

test('semantic comparison rejects corrupt vectors instead of ranking stale data', () => {
  assert.equal(isValidVector([0.5, -0.5]), true);
  assert.equal(isValidVector([0.5, Number.POSITIVE_INFINITY]), false);
  assert.equal(isValidChunkSet([
    { meetingId: 'm1', chunkIndex: 0, text: 'first', vector: [1, 0] },
    { meetingId: 'm1', chunkIndex: 2, text: 'missing middle', vector: [0, 1] },
  ], 'm1'), false);
  assert.throws(() => cosine([1, 0], [1]), /malformed search vectors/);
});

test('semantic index identity follows the exact current transcript', async () => {
  const current = indexedMeeting('m1', 'Opening decision. Final current action.');
  const storage = memoryVectorStore();
  await saveMeetingVectors(current, embeddedChunks(current.transcript), storage);
  const saved = storage.values.get('m1');

  assert.equal(isValidMeetingVectorIndex(saved, 'm1'), true);
  assert.equal((saved as { version: number }).version, 2);
  assert.equal((saved as { embeddingSchema: string }).embeddingSchema, SEMANTIC_INDEX_SCHEMA);
  assert.equal(meetingVectorIndexMatches(saved, current), true);
  assert.deepEqual(await indexedMeetingIds([current], storage), new Set(['m1']));

  const replaced = indexedMeeting('m1', 'Opening decision. Different repaired action.');
  assert.equal(meetingVectorIndexMatches(saved, replaced), false, 'same meeting id must not authorize an older transcript index');
  assert.deepEqual(await indexedMeetingIds([replaced], storage), new Set());
  assert.deepEqual(await searchVectors([1, 0], [replaced], 5, storage), [], 'stale semantic excerpts must not reach Ask');
});

test('semantic freshness uses one bounded bulk read at high meeting counts', async () => {
  const meetings = Array.from({ length: 500 }, (_, index) => indexedMeeting(`m${index}`, `Transcript ${index}.`));
  const storage = memoryVectorStore();
  for (const meeting of meetings) await saveMeetingVectors(meeting, embeddedChunks(meeting.transcript), storage);
  const before = storage.stats();
  const ids = await indexedMeetingIds(meetings, storage);
  const after = storage.stats();

  assert.equal(ids.size, 500);
  assert.equal(after.getAllCalls - before.getAllCalls, 1, 'freshness must use one bounded bulk transaction');
  assert.equal(after.getCalls - before.getCalls, 0, 'freshness must not multiply one get transaction per meeting');
  assert.equal(indexableMeetingCount([...meetings, { ...meetings[0], id: 'silent', transcript: '', ...transcriptIntegrity('') }]), 500);
});

test('semantic index rejects an older or different embedding contract', async () => {
  const current = indexedMeeting('m1', 'A verified transcript for schema testing.');
  const storage = memoryVectorStore();
  await saveMeetingVectors(current, embeddedChunks(current.transcript), storage);
  const wrongSchema = structuredClone(storage.values.get('m1')) as { embeddingSchema: string };
  wrongSchema.embeddingSchema = 'different-model-with-the-same-dimension';
  storage.values.set('m1', wrongSchema);

  assert.equal(isValidMeetingVectorIndex(wrongSchema, 'm1'), false);
  assert.deepEqual(await indexedMeetingIds([current], storage), new Set());
  assert.deepEqual(await searchVectors([1, 0], [current], 5, storage), []);
});

test('semantic index rejects altered excerpts and legacy unversioned arrays', async () => {
  const current = indexedMeeting('m1', 'First exact excerpt. Second exact excerpt.');
  const storage = memoryVectorStore();
  await saveMeetingVectors(current, embeddedChunks(current.transcript), storage);
  const saved = structuredClone(storage.values.get('m1')) as { chunks: Array<{ text: string }> };
  saved.chunks[0].text = 'altered excerpt from another transcript';
  storage.values.set('m1', saved);

  assert.equal(meetingVectorIndexMatches(saved, current), false);
  assert.deepEqual(await searchVectors([1, 0], [current], 5, storage), []);

  storage.values.set('m1', embeddedChunks(current.transcript).map(chunk => ({ ...chunk, meetingId: 'm1' })));
  assert.equal(isValidMeetingVectorIndex(storage.values.get('m1'), 'm1'), false, 'legacy arrays require a safe rebuild');
  assert.deepEqual(await indexedMeetingIds([current], storage), new Set());
});

test('index save refuses chunks that do not match the verified transcript', async () => {
  const current = indexedMeeting('m1', 'Verified transcript sentence.');
  await assert.rejects(
    saveMeetingVectors(current, [{ text: 'different stale sentence', chunkIndex: 0, vector: [1, 0] }], memoryVectorStore()),
    /did not match the verified transcript/,
  );
});
