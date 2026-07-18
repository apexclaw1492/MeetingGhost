import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingStartupRecovery } from '../src/utils/recordingStartupRecovery.ts';

test('timed-out recording startup preserves every verified audio segment', () => {
  const result = recordingStartupRecovery(
    'meeting',
    {
      segments: 1, segmentIds: [0], failedSegments: [], totalBytes: 500,
      recordedMs: 15000, mimeType: 'audio/mp4',
    },
    [{ meetingId: 'meeting', segmentIds: [0, 2], totalBytes: 900 }],
    'startup timeout',
  );
  assert.equal(result.kind, 'recovered');
  if (result.kind !== 'recovered') return;
  assert.deepEqual(result.patch.segmentIds, [0, 2]);
  assert.equal(result.patch.segments, 2);
  assert.equal(result.patch.bytes, 900);
  assert.equal(result.patch.status, 'transcription_interrupted');
});

test('timed-out startup removes an empty shell only after stop and scan both complete', () => {
  const result = recordingStartupRecovery(
    'meeting',
    { segments: 0, segmentIds: [], failedSegments: [], totalBytes: 0, recordedMs: 0, mimeType: 'audio/mp4' },
    [],
    'startup timeout',
  );
  assert.deepEqual(result, { kind: 'empty' });
});

test('timed-out startup keeps a recovery shell when stop or storage evidence is uncertain', () => {
  const result = recordingStartupRecovery('meeting', null, [], 'startup timeout');
  assert.equal(result.kind, 'uncertain');
  if (result.kind !== 'uncertain') return;
  assert.equal(result.patch.status, 'recovery_required');
  assert.match(result.patch.diag || '', /no recording data was deleted/i);
});
