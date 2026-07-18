import test from 'node:test';
import assert from 'node:assert/strict';
import { SegmentedRecorder } from '../src/utils/recorder.ts';

class FakeMediaRecorder {
  state: RecordingState = 'inactive';
  mimeType = 'audio/test';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(_stream: MediaStream) {}

  start() {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) });
  }

  stop() {
    this.state = 'inactive';
    queueMicrotask(() => this.onstop?.());
  }
}

function fakeStream(): MediaStream {
  const track = { onmute: null, onunmute: null, onended: null, stop() {} };
  return { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
}

const callbacks = {
  onSegmentSaved() {}, onSegmentFailed() {}, onStorageWarning() {}, onAutoStop() {}, onInterruption() {},
};

const testDependencies = (writeSegment: (id: string, segment: number, blob: Blob) => Promise<void>) => ({
  writeSegment,
  freeBytes: async () => null,
  storageWarnBytes: 500,
  storageStopBytes: 100,
  log() {},
  logError() {},
});

test('stop waits for a rotation already inside MediaRecorder onstop', async () => {
  const oldMediaRecorder = globalThis.MediaRecorder;
  const oldWindow = globalThis.window;
  Object.assign(globalThis, { MediaRecorder: FakeMediaRecorder, window: globalThis });
  try {
    const writes: number[] = [];
    const recorder = new SegmentedRecorder('race', callbacks, testDependencies(
      async (_id, segment) => { await Promise.resolve(); writes.push(segment); },
    ));
    await recorder.start(fakeStream());
    (recorder as unknown as { rotate(): void }).rotate();
    const result = await recorder.stop();
    assert.deepEqual(writes, [0]);
    assert.deepEqual(result.segmentIds, [0]);
    assert.equal(result.segments, 1);
    assert.equal(result.totalBytes, 5);
  } finally {
    Object.assign(globalThis, { MediaRecorder: oldMediaRecorder, window: oldWindow });
  }
});

test('concurrent stop calls share one finalization and never duplicate a segment', async () => {
  const oldMediaRecorder = globalThis.MediaRecorder;
  const oldWindow = globalThis.window;
  Object.assign(globalThis, { MediaRecorder: FakeMediaRecorder, window: globalThis });
  try {
    let writes = 0;
    const recorder = new SegmentedRecorder('idempotent', callbacks, testDependencies(async () => { writes++; }));
    await recorder.start(fakeStream());
    const first = recorder.stop();
    const second = recorder.stop();
    assert.equal(first, second);
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a, b);
    assert.equal(writes, 1);
    assert.deepEqual(a.segmentIds, [0]);
  } finally {
    Object.assign(globalThis, { MediaRecorder: oldMediaRecorder, window: oldWindow });
  }
});

test('two-hour-equivalent manifest keeps later audio after a middle write failure', async () => {
  const oldMediaRecorder = globalThis.MediaRecorder;
  const oldWindow = globalThis.window;
  Object.assign(globalThis, { MediaRecorder: FakeMediaRecorder, window: globalThis });
  try {
    const recorder = new SegmentedRecorder('two-hours', callbacks, testDependencies(async (_id, segment) => {
      if (segment === 57) throw new Error('simulated disk write failure');
    }));
    await recorder.start(fakeStream());
    // 119 rotations plus the final stop represent 120 one-minute files.
    for (let i = 0; i < 119; i++) {
      (recorder as unknown as { rotate(): void }).rotate();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const result = await recorder.stop();
    assert.equal(result.segmentIds.length, 119);
    assert.deepEqual(result.failedSegments, [57]);
    assert.equal(result.segmentIds.includes(57), false);
    assert.equal(result.segmentIds.includes(58), true);
    assert.equal(result.segmentIds.at(-1), 119);
  } finally {
    Object.assign(globalThis, { MediaRecorder: oldMediaRecorder, window: oldWindow });
  }
});

test('an ended microphone track auto-stops instead of pretending to record', async () => {
  const oldMediaRecorder = globalThis.MediaRecorder;
  const oldWindow = globalThis.window;
  Object.assign(globalThis, { MediaRecorder: FakeMediaRecorder, window: globalThis });
  try {
    let reason = '';
    const stream = fakeStream();
    const recorder = new SegmentedRecorder('ended-track', {
      ...callbacks,
      onAutoStop: value => { reason = value; },
    }, testDependencies(async () => {}));
    await recorder.start(stream);
    stream.getAudioTracks()[0].onended?.(new Event('ended'));
    const result = await recorder.stop();
    assert.match(reason, /Audio input ended/i);
    assert.equal(recorder.isActive, false);
    assert.deepEqual(result.segmentIds, [0]);
  } finally {
    Object.assign(globalThis, { MediaRecorder: oldMediaRecorder, window: oldWindow });
  }
});
