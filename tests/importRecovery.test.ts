import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveredImportPatch } from '../src/utils/importRecovery.ts';

test('a verified native import survives a completion-callback timeout', () => {
  const patch = recoveredImportPatch('meeting-42', [
    { meetingId: 'other', segmentIds: [0], totalBytes: 5 },
    { meetingId: 'meeting-42', segmentIds: [0], totalBytes: 987_654_321 },
  ], 'bridge callback timed out');

  assert.deepEqual(patch, {
    status: 'transcription_interrupted',
    audioKind: 'segments',
    segments: 1,
    segmentIds: [0],
    bytes: 987_654_321,
    diag: 'The import result was interrupted (bridge callback timed out), but 1 verified audio file remained in protected storage. Tap Transcribe Audio to continue.',
  });
});

test('an import error without a published file is not misreported as recovered', () => {
  assert.equal(recoveredImportPatch('missing', [
    { meetingId: 'other', segmentIds: [0], totalBytes: 5 },
  ], 'provider failed'), null);
});
