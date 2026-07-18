import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireMicrophoneStream } from '../src/utils/microphone.ts';

test('bounded microphone acquisition closes a stream that arrives after timeout', async () => {
  let resolveRequest!: (stream: MediaStream) => void;
  const request = new Promise<MediaStream>(resolve => { resolveRequest = resolve; });
  let stopped = false;
  const pending = acquireMicrophoneStream(request, 5);
  await assert.rejects(pending, /Microphone access did not complete/);
  resolveRequest({
    getTracks: () => [{ stop: () => { stopped = true; } }],
  } as unknown as MediaStream);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(stopped, true, 'late permission success must not leave an invisible live microphone');
});

test('bounded microphone acquisition returns an on-time stream untouched', async () => {
  let stopped = false;
  const stream = {
    getTracks: () => [{ stop: () => { stopped = true; } }],
  } as unknown as MediaStream;
  assert.equal(await acquireMicrophoneStream(Promise.resolve(stream), 50), stream);
  assert.equal(stopped, false);
});
