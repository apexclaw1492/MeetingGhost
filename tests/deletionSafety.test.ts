import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteMeetingArtifacts } from '../src/utils/deletionSafety.ts';

test('meeting metadata may be removed only after every artifact deletion succeeds', async () => {
  const completed: string[] = [];
  await deleteMeetingArtifacts({
    async deleteAudio() { completed.push('audio'); },
    async deleteTranscript() { completed.push('transcript'); },
    async deleteSearchIndex() { completed.push('index'); },
  }, 100);
  assert.deepEqual(completed.sort(), ['audio', 'index', 'transcript']);
});

test('a partial storage deletion failure is terminal and visible to the caller', async () => {
  let audioAttempted = false;
  let indexAttempted = false;
  await assert.rejects(
    deleteMeetingArtifacts({
      async deleteAudio() { audioAttempted = true; },
      async deleteTranscript() { throw new Error('transcript store is unavailable'); },
      async deleteSearchIndex() { indexAttempted = true; },
    }, 100),
    /transcript store is unavailable/,
  );
  assert.equal(audioAttempted, true);
  assert.equal(indexAttempted, true);
});

test('a stalled deletion reaches a deadline instead of hiding the meeting forever', async () => {
  await assert.rejects(
    deleteMeetingArtifacts({
      deleteAudio: () => new Promise<void>(() => { /* injected stall */ }),
      async deleteTranscript() { /* success */ },
      async deleteSearchIndex() { /* success */ },
    }, 10),
    /Audio deletion timed out/,
  );
});
