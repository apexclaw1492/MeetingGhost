import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelInitWatchdog } from '../src/utils/modelInitWatchdog.ts';

class FakeTimers {
  now = 0;
  nextId = 0;
  jobs = new Map<number, { at: number; callback: () => void }>();

  schedule = (callback: () => void, delayMs: number) => {
    const id = ++this.nextId;
    this.jobs.set(id, { at: this.now + delayMs, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  cancel = (timer: ReturnType<typeof setTimeout>) => {
    this.jobs.delete(timer as unknown as number);
  };

  advance(ms: number) {
    const target = this.now + ms;
    while (true) {
      const next = [...this.jobs.entries()]
        .filter(([, job]) => job.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.jobs.delete(next[0]);
      this.now = next[1].at;
      next[1].callback();
    }
    this.now = target;
  }
}

test('model initialization stalls terminate and late replies stay stale', () => {
  const timers = new FakeTimers();
  const reasons: string[] = [];
  const watchdog = new ModelInitWatchdog(timers.schedule, timers.cancel);
  const initId = watchdog.begin('whisper', { idleMs: 100, hardMs: 500 }, reason => reasons.push(reason));

  timers.advance(99);
  assert.deepEqual(reasons, []);
  timers.advance(1);
  assert.deepEqual(reasons, ['stalled']);
  assert.equal(watchdog.finish('whisper', initId), false);
  assert.equal(watchdog.progress('whisper', initId), false);
});

test('progress extends inactivity but never the absolute initialization deadline', () => {
  const timers = new FakeTimers();
  const reasons: string[] = [];
  const watchdog = new ModelInitWatchdog(timers.schedule, timers.cancel);
  const initId = watchdog.begin('embed', { idleMs: 100, hardMs: 250 }, reason => reasons.push(reason));

  timers.advance(80);
  assert.equal(watchdog.progress('embed', initId), true);
  timers.advance(80);
  assert.equal(watchdog.progress('embed', initId), true);
  timers.advance(80);
  assert.equal(watchdog.progress('embed', initId), true);
  timers.advance(10);
  assert.deepEqual(reasons, ['deadline']);
});

test('a retry supersedes the old initialization generation', () => {
  const timers = new FakeTimers();
  const reasons: string[] = [];
  const watchdog = new ModelInitWatchdog(timers.schedule, timers.cancel);
  const oldId = watchdog.begin('gemma', { idleMs: 100, hardMs: 500 }, reason => reasons.push(`old:${reason}`));
  const retryId = watchdog.begin('gemma', { idleMs: 100, hardMs: 500 }, reason => reasons.push(`retry:${reason}`));

  assert.notEqual(oldId, retryId);
  assert.equal(watchdog.finish('gemma', oldId), false);
  assert.equal(watchdog.finish('gemma', retryId), true);
  timers.advance(1000);
  assert.deepEqual(reasons, []);
});
