import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareVerifiedNativeShareFile } from '../src/utils/nativeShareFile.ts';

function fakeIO(readBack: string, uri = 'file:///verified-export') {
  let written = '';
  return {
    io: {
      async writeFile(options: { data: string }) { written = options.data; },
      async readFile() { return { data: readBack === '$WRITTEN' ? written : readBack }; },
      async getUri() { return { uri }; },
    },
    written: () => written,
  };
}

test('native share preparation returns a URI only after exact file readback', async () => {
  const fake = fakeIO('$WRITTEN');
  const uri = await prepareVerifiedNativeShareFile({
    path: 'exports/complete.md',
    data: 'START\ncomplete transcript\nFINAL',
    format: 'utf8',
    label: 'Markdown',
    timeoutMs: 100,
  }, fake.io);
  assert.equal(uri, 'file:///verified-export');
  assert.equal(fake.written(), 'START\ncomplete transcript\nFINAL');
});

test('native share preparation rejects a truncated Markdown cache file', async () => {
  const fake = fakeIO('START\ncomplete transcript');
  await assert.rejects(
    prepareVerifiedNativeShareFile({
      path: 'exports/truncated.md',
      data: 'START\ncomplete transcript\nFINAL',
      format: 'utf8',
      label: 'Markdown',
      timeoutMs: 100,
    }, fake.io),
    /did not match.*Nothing was shared/,
  );
});

test('native share preparation rejects a truncated PDF payload before URI resolution', async () => {
  let uriRequested = false;
  const io = {
    async writeFile() { /* simulated native write */ },
    async readFile() { return { data: 'JVBERi0xLjQ=' }; },
    async getUri() { uriRequested = true; return { uri: 'file:///must-not-share' }; },
  };
  await assert.rejects(
    prepareVerifiedNativeShareFile({
      path: 'exports/truncated.pdf',
      data: 'JVBERi0xLjQKRU9G',
      format: 'base64',
      label: 'PDF',
      timeoutMs: 100,
    }, io),
    /did not match.*Nothing was shared/,
  );
  assert.equal(uriRequested, false, 'a mismatched file must never receive a share URI');
});
