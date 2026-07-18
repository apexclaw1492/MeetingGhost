import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlaybackSource } from '../src/utils/playbackSource.ts';

test('native hours-long playback streams from a file URI without reading the complete blob', async () => {
  let blobReads = 0;
  let objectUrls = 0;
  const source = await resolvePlaybackSource({
    nativeSegmented: true,
    loadNativeUri: async () => 'file:///private/recordings/imported/seg-0',
    convertNativeUri: uri => `capacitor://localhost/_capacitor_file_${uri}`,
    loadBlob: async () => { blobReads++; return new Blob(['must-not-load']); },
    createObjectUrl: () => { objectUrls++; return 'blob:must-not-create'; },
  });

  assert.deepEqual(source, {
    url: 'capacitor://localhost/_capacitor_file_file:///private/recordings/imported/seg-0',
    revokeWhenDone: false,
  });
  assert.equal(blobReads, 0);
  assert.equal(objectUrls, 0);
});

test('web playback keeps the bounded Blob/object-URL path', async () => {
  const audio = new Blob(['audio']);
  let nativeReads = 0;
  const source = await resolvePlaybackSource({
    nativeSegmented: false,
    loadNativeUri: async () => { nativeReads++; return 'file:///unused'; },
    convertNativeUri: uri => uri,
    loadBlob: async () => audio,
    createObjectUrl: blob => blob === audio ? 'blob:verified-audio' : 'blob:wrong',
  });

  assert.deepEqual(source, { url: 'blob:verified-audio', revokeWhenDone: true });
  assert.equal(nativeReads, 0);
});

test('missing native audio URI ends visibly instead of falling back to a whole-file read', async () => {
  let blobReads = 0;
  const source = await resolvePlaybackSource({
    nativeSegmented: true,
    loadNativeUri: async () => null,
    convertNativeUri: uri => uri,
    loadBlob: async () => { blobReads++; return new Blob(['unsafe-fallback']); },
    createObjectUrl: () => 'blob:unsafe-fallback',
  });

  assert.equal(source, null);
  assert.equal(blobReads, 0);
});
