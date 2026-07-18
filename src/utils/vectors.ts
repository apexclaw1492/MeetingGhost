import { idb } from './idb.ts';
import { assertTranscriptIntegrity } from './meetingContent.ts';
import { SEMANTIC_INDEX_SCHEMA } from './semanticIndexSchema.ts';
import type { MeetingRecord } from './store.ts';

export interface Chunk {
  meetingId: string;
  chunkIndex: number;
  text: string;
  vector: number[];
}

export interface MeetingVectorIndex {
  version: 2;
  embeddingSchema: typeof SEMANTIC_INDEX_SCHEMA;
  meetingId: string;
  transcriptChecksum: string;
  transcriptChars: number;
  transcriptBytes: number;
  chunks: Chunk[];
}

interface VectorStore {
  get<T>(store: 'vectors', key: string): Promise<T>;
  put(store: 'vectors', key: string, value: unknown): Promise<unknown>;
  del(store: 'vectors', key: string): Promise<unknown>;
  getAll<T>(store: 'vectors'): Promise<T[]>;
}

type IndexedMeeting = Pick<MeetingRecord,
  'id' | 'transcript' | 'transcriptOutcome' | 'transcriptChars' | 'transcriptBytes' | 'transcriptChecksum'>;

export function isValidVector(vector: unknown, dimension?: number): vector is number[] {
  return Array.isArray(vector)
    && vector.length > 0
    && (dimension === undefined || vector.length === dimension)
    && vector.every(value => typeof value === 'number' && Number.isFinite(value));
}

/** Reject incomplete/NaN/mixed-dimension model output before it can be indexed. */
export function assertEmbeddingBatch(vectors: unknown, expectedCount: number, dimension?: number): number {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    throw new Error(`Search model returned ${Array.isArray(vectors) ? vectors.length : 0}/${expectedCount} embeddings. Indexing stopped without replacing the previous index.`);
  }
  const expectedDimension = dimension ?? (Array.isArray(vectors[0]) ? vectors[0].length : 0);
  if (!expectedDimension || !vectors.every(vector => isValidVector(vector, expectedDimension))) {
    throw new Error('Search model returned a malformed or inconsistent embedding. Indexing stopped without replacing the previous index.');
  }
  return expectedDimension;
}

export function isValidChunkSet(value: unknown, meetingId?: string): value is Chunk[] {
  if (!Array.isArray(value) || !value.length) return false;
  const dimension = Array.isArray(value[0]?.vector) ? value[0].vector.length : 0;
  return dimension > 0 && value.every((chunk, expectedIndex) => chunk
    && typeof chunk.text === 'string'
    && chunk.text.trim().length > 0
    && chunk.chunkIndex === expectedIndex
    && (!meetingId || chunk.meetingId === meetingId)
    && isValidVector(chunk.vector, dimension));
}

export function isValidMeetingVectorIndex(value: unknown, meetingId?: string): value is MeetingVectorIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const index = value as Partial<MeetingVectorIndex>;
  return index.version === 2
    && index.embeddingSchema === SEMANTIC_INDEX_SCHEMA
    && typeof index.meetingId === 'string'
    && (!meetingId || index.meetingId === meetingId)
    && Number.isSafeInteger(index.transcriptChars) && (index.transcriptChars || 0) > 0
    && Number.isSafeInteger(index.transcriptBytes) && (index.transcriptBytes || 0) > 0
    && typeof index.transcriptChecksum === 'string'
    && index.transcriptChecksum.startsWith('fnv1a64-v1:')
    && isValidChunkSet(index.chunks, index.meetingId);
}

/* Split a transcript into ~400-char chunks on sentence boundaries */
export function chunkTranscript(text: string, maxLen = 400): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) || [text];
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if (current && current.length + s.length > maxLen) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function cosine(a: number[], b: number[]): number {
  // Vectors are already normalized by the embedder — dot product suffices
  if (!isValidVector(a) || !isValidVector(b, a.length)) throw new Error('Cannot compare malformed search vectors.');
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export function meetingVectorIndexMatches(index: unknown, meeting: IndexedMeeting): index is MeetingVectorIndex {
  if (!isValidMeetingVectorIndex(index, meeting.id)
      || meeting.transcriptOutcome !== 'text'
      || index.transcriptChecksum !== meeting.transcriptChecksum
      || index.transcriptChars !== meeting.transcriptChars
      || index.transcriptBytes !== meeting.transcriptBytes) return false;
  // Hydrated callers get the strongest check: the saved semantic excerpts must
  // exactly match the chunks derived from the verified current transcript.
  if (meeting.transcript) {
    const expectedChunks = chunkTranscript(meeting.transcript);
    return expectedChunks.length === index.chunks.length
      && expectedChunks.every((text, chunkIndex) => index.chunks[chunkIndex]?.text === text);
  }
  return true;
}

export function indexableMeetingCount(meetings: IndexedMeeting[]): number {
  return new Set(meetings
    .filter(meeting => meeting.transcriptOutcome === 'text' || !!meeting.transcript?.trim())
    .map(meeting => meeting.id)).size;
}

/* One IDB record per meeting: its chunk list */
export async function saveMeetingVectors(
  meeting: IndexedMeeting,
  chunks: Omit<Chunk, 'meetingId'>[],
  storage: VectorStore = idb,
): Promise<void> {
  const integrity = assertTranscriptIntegrity(meeting.transcript, meeting);
  if (integrity.transcriptOutcome !== 'text') throw new Error('An empty transcript does not need a semantic index.');
  const complete = chunks.map(c => ({ ...c, meetingId: meeting.id }));
  const expectedChunks = chunkTranscript(meeting.transcript);
  if (!isValidChunkSet(complete, meeting.id)
      || complete.length !== expectedChunks.length
      || !expectedChunks.every((text, chunkIndex) => complete[chunkIndex]?.text === text)) {
    throw new Error('Search index was incomplete or did not match the verified transcript and was not saved. Retry indexing from AI Models.');
  }
  const index: MeetingVectorIndex = {
    version: 2,
    embeddingSchema: SEMANTIC_INDEX_SCHEMA,
    meetingId: meeting.id,
    transcriptChecksum: integrity.transcriptChecksum,
    transcriptChars: integrity.transcriptChars,
    transcriptBytes: integrity.transcriptBytes,
    chunks: complete,
  };
  await storage.put('vectors', meeting.id, index);
  const verified = await storage.get<unknown>('vectors', meeting.id);
  if (!meetingVectorIndexMatches(verified, { ...meeting, ...integrity })) {
    throw new Error('Search index verification failed after saving. Full-text search remains available; retry semantic indexing.');
  }
}

export async function deleteMeetingVectors(meetingId: string, storage: VectorStore = idb) {
  await storage.del('vectors', meetingId);
}

export async function indexedMeetingIds(
  meetings?: IndexedMeeting[],
  storage: VectorStore = idb,
): Promise<Set<string>> {
  const valid = new Set<string>();
  const expected = meetings ? new Map(meetings.map(meeting => [meeting.id, meeting])) : undefined;
  // One bounded IndexedDB transaction regardless of meeting count. A
  // sequential key+get loop could multiply the per-transaction timeout by
  // hundreds of meetings and leave launch/Ask/Diagnostics effectively stuck.
  for (const index of await storage.getAll<unknown>('vectors')) {
    if (!isValidMeetingVectorIndex(index)) continue;
    const meeting = expected?.get(index.meetingId);
    if (expected ? !!meeting && meetingVectorIndexMatches(index, meeting) : true) {
      valid.add(index.meetingId);
    }
  }
  return valid;
}

export async function searchVectors(
  queryVector: number[],
  meetings: IndexedMeeting[],
  topK = 5,
  storage: VectorStore = idb,
): Promise<Chunk[]> {
  if (!isValidVector(queryVector)) throw new Error('The semantic query embedding was invalid. Full-text search remains available.');
  const expected = new Map(meetings.map(meeting => [meeting.id, meeting]));
  const all = (await storage.getAll<unknown>('vectors'))
    .filter((value): value is MeetingVectorIndex => {
      if (!isValidMeetingVectorIndex(value)) return false;
      const meeting = expected.get(value.meetingId);
      return !!meeting && meetingVectorIndexMatches(value, meeting);
    })
    .flatMap(index => index.chunks);
  return all
    .filter(chunk => chunk && isValidVector(chunk.vector, queryVector.length))
    .map(c => ({ c, score: cosine(queryVector, c.vector) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, topK)
    .map(x => x.c);
}
