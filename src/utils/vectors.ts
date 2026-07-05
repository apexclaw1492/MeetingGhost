import { idb } from './idb';

export interface Chunk {
  meetingId: string;
  chunkIndex: number;
  text: string;
  vector: number[];
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
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/* One IDB record per meeting: its chunk list */
export async function saveMeetingVectors(meetingId: string, chunks: Omit<Chunk, 'meetingId'>[]) {
  await idb.put('vectors', meetingId, chunks.map(c => ({ ...c, meetingId })));
}

export async function deleteMeetingVectors(meetingId: string) {
  await idb.del('vectors', meetingId);
}

export async function indexedMeetingIds(): Promise<Set<string>> {
  return new Set((await idb.keys('vectors')).map(String));
}

export async function searchVectors(queryVector: number[], topK = 5): Promise<Chunk[]> {
  const all = (await idb.getAll<Chunk[]>('vectors')).flat();
  return all
    .map(c => ({ c, score: cosine(queryVector, c.vector) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, topK)
    .map(x => x.c);
}
