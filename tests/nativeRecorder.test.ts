import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeSegmentedRecorder, NATIVE_SEGMENT_SECONDS, nativeStatusResult } from '../src/utils/nativeRecorder.ts';
import type { RecordingSessionPlugin } from '../src/utils/nativeRecorder.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const callbacks = {
  onSegmentSaved: () => {},
  onSegmentFailed: () => {},
  onStorageWarning: () => {},
  onAutoStop: () => {},
  onInterruption: () => {},
};

const deps = {
  storageWarnBytes: 500,
  storageStopBytes: 100,
  log: () => {},
  logError: () => {},
};

test('native recorder status preserves exact sparse manifests without count inference', () => {
  const result = nativeStatusResult({
    active: false,
    segmentIds: [3, 0, 3, 2],
    failedSegments: [1, 1],
    totalBytes: 42_000,
    recordedMs: 45_250,
    mimeType: 'audio/mp4',
  });
  assert.deepEqual(result.segmentIds, [0, 2, 3]);
  assert.deepEqual(result.failedSegments, [1]);
  assert.equal(result.segments, 3);
  assert.equal(result.totalBytes, 42_000);
  assert.equal(result.recordedMs, 45_250);
});

test('native capture bounds the uncommitted crash tail to fifteen seconds', () => {
  assert.equal(NATIVE_SEGMENT_SECONDS, 15);
  assert.ok(NATIVE_SEGMENT_SECONDS <= 15);
});

test('malformed native status cannot create negative byte or duration metadata', () => {
  const result = nativeStatusResult({ active: false, totalBytes: -10, recordedMs: Number.NaN });
  assert.deepEqual(result.segmentIds, []);
  assert.equal(result.totalBytes, 0);
  assert.equal(result.recordedMs, 0);
  assert.equal(result.mimeType, 'audio/mp4');
});

test('a native recorder that starts after cancellation is stopped again', async () => {
  const lateStart = deferred<{ active: boolean; segmentIds: number[]; totalBytes: number; recordedMs: number }>();
  const startCalled = deferred<void>();
  let stopCalls = 0;
  const session: RecordingSessionPlugin = {
    addListener: async () => ({ remove: async () => {} }),
    start: () => { startCalled.resolve(); return lateStart.promise; },
    stop: async () => { stopCalls++; return { active: false, segmentIds: [], totalBytes: 0, recordedMs: 0 }; },
    flush: async () => ({ active: false }),
    status: async () => ({ active: false }),
  };
  const recorder = new NativeSegmentedRecorder('late-start', callbacks, deps, session);

  const starting = recorder.start();
  await startCalled.promise;
  await recorder.stop();
  lateStart.resolve({ active: true, segmentIds: [], totalBytes: 0, recordedMs: 0 });

  await assert.rejects(starting, /completed after cancellation and was stopped safely/);
  assert.equal(stopCalls, 2);
  assert.equal(recorder.isActive, false);
});

test('a listener that attaches after startup cancellation is removed and capture never starts', async () => {
  const lateListener = deferred<{ remove: () => Promise<void> }>();
  let listenerRemovals = 0;
  let startCalls = 0;
  const session: RecordingSessionPlugin = {
    addListener: () => lateListener.promise,
    start: async () => { startCalls++; return { active: true }; },
    stop: async () => ({ active: false }),
    flush: async () => ({ active: false }),
    status: async () => ({ active: false }),
  };
  const recorder = new NativeSegmentedRecorder('late-listener', callbacks, deps, session);

  const starting = recorder.start();
  await Promise.resolve();
  await recorder.stop();
  lateListener.resolve({ remove: async () => { listenerRemovals++; } });

  await assert.rejects(starting, /startup was canceled/);
  assert.equal(listenerRemovals, 1);
  assert.equal(startCalls, 0);
});

test('native memory pressure is logged without stopping capture', async () => {
  const listeners = new Map<string, (event: any) => void>();
  const events: Array<{ event: string; data?: Record<string, unknown> }> = [];
  let reportedLevel: number | string | undefined;
  const session: RecordingSessionPlugin = {
    addListener: async (name, listener) => {
      listeners.set(name, listener);
      return { remove: async () => { listeners.delete(name); } };
    },
    start: async () => ({ active: true, segmentIds: [0], totalBytes: 4096, recordedMs: 15_000 }),
    stop: async () => ({ active: false, segmentIds: [0], totalBytes: 4096, recordedMs: 15_000 }),
    flush: async () => ({ active: true }),
    status: async () => ({ active: true }),
  };
  const recorder = new NativeSegmentedRecorder('memory-event', {
    ...callbacks,
    onMemoryPressure: level => { reportedLevel = level; },
  }, {
    ...deps,
    log: (event, data) => events.push({ event, data }),
  }, session);

  await recorder.start();
  listeners.get('memoryPressure')?.({
    active: true, seg: 0, bytes: 4096, ms: 15_000,
    segmentIds: [0], totalBytes: 4096, recordedMs: 15_000,
    memoryPressureLevel: 15, freeBytes: 128_000,
  });

  assert.equal(reportedLevel, 15);
  assert.equal(recorder.isActive, true);
  assert.equal(events.some(item => item.event === 'rec.native.memory.pressure' && item.data?.freeBytes === 128_000), true);
  await recorder.stop();
});
