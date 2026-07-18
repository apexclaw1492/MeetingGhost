import test from 'node:test';
import assert from 'node:assert/strict';
import { audioChunkRanges, audioTimeChunkRanges } from '../src/utils/audioChunks.ts';
import { withTimeout } from '../src/utils/async.ts';
import { pcm16Base64ToFloat32 } from '../src/utils/pcm.ts';

test('two-hour imported audio is split into contiguous bounded inference units', () => {
  const sampleRate = 16_000;
  const totalSamples = sampleRate * 60 * 60 * 2;
  const maxSamples = sampleRate * 60 * 5;
  const ranges = audioChunkRanges(totalSamples, maxSamples);
  assert.equal(ranges.length, 24);
  assert.deepEqual(ranges[0], { start: 0, end: maxSamples });
  assert.equal(ranges[ranges.length - 1].end, totalSamples);
  ranges.forEach((range, index) => {
    assert.equal(range.end - range.start <= maxSamples, true);
    if (index > 0) assert.equal(range.start, ranges[index - 1].end, 'chunk boundaries must have no gaps or overlap');
  });
});

test('two-hour iOS/Android audio is split into contiguous one-minute native units', () => {
  const ranges = audioTimeChunkRanges(2 * 60 * 60 * 1000 + 321, 60_000);
  assert.equal(ranges.length, 121);
  assert.deepEqual(ranges[0], { startMs: 0, durationMs: 60_000 });
  assert.deepEqual(ranges[ranges.length - 1], { startMs: 7_200_000, durationMs: 321 });
  ranges.forEach((range, index) => {
    assert.equal(range.durationMs <= 60_000, true);
    if (index > 0) {
      const previous = ranges[index - 1];
      assert.equal(range.startMs, previous.startMs + previous.durationMs, 'native ranges must have no gaps or overlap');
    }
  });
});

test('native PCM16 bridge payload is length-verified and decoded little-endian', () => {
  const bytes = Uint8Array.from([0x00, 0x80, 0x00, 0x00, 0xff, 0x7f]);
  const base64 = Buffer.from(bytes).toString('base64');
  const decoded = pcm16Base64ToFloat32(base64, 3);
  assert.deepEqual(Array.from(decoded), [-1, 0, 32767 / 32768]);
  assert.throws(() => pcm16Base64ToFloat32(base64, 4), /verification failed/);
});

test('stalled platform operations end with a visible timeout error', async () => {
  await assert.rejects(
    withTimeout(new Promise<string>(() => { /* intentionally stalled */ }), 10, 'storage bridge timed out'),
    /storage bridge timed out/,
  );
  assert.equal(await withTimeout(Promise.resolve('ready'), 100, 'should not time out'), 'ready');
});
