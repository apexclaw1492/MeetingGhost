import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestRegistry } from '../src/utils/requestRegistry.ts';

test('late worker replies cannot resolve a newer request', async () => {
  const registry = new RequestRegistry<string>();
  const first = registry.create(10, 'first timed out');
  await assert.rejects(first.promise, /first timed out/);

  const second = registry.create(1000, 'second timed out');
  assert.equal(registry.resolve(first.requestId, 'stale result'), false);
  assert.equal(registry.resolve(second.requestId, 'correct result'), true);
  assert.equal(await second.promise, 'correct result');
  assert.equal(registry.size, 0);
});

test('worker crashes reject every outstanding correlated request', async () => {
  const registry = new RequestRegistry<number>();
  const first = registry.create(1000, 'timeout');
  const second = registry.create(1000, 'timeout');
  registry.rejectAll(new Error('worker crashed'));
  await assert.rejects(first.promise, /worker crashed/);
  await assert.rejects(second.promise, /worker crashed/);
  assert.equal(registry.size, 0);
});
