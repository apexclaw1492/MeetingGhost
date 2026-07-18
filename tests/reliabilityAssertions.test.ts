import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReliabilitySnapshot, diagnosticMeetingMetadata } from '../src/utils/reliabilityAssertions.ts';
import { transcriptIntegrity } from '../src/utils/meetingContent.ts';
import type { MeetingRecord } from '../src/utils/store.ts';

const base: MeetingRecord = {
  id: 'm1', date: 'today', dur: 90, title: 'Secret title',
  transcript: 'Secret transcript', transcriptStored: true,
  summary: 'Secret summary', actionItems: [{ text: 'Secret action', done: false }],
  status: 'complete', audioKind: 'segments', segments: 2,
  segmentIds: [0, 1], bytes: 2048,
  ...transcriptIntegrity('Secret transcript'),
};

test('reliability snapshot accepts a complete exact saved meeting', () => {
  const snapshot = buildReliabilitySnapshot([base]);
  assert.equal(snapshot.assertions.every(assertion => assertion.passed), true);
  assert.deepEqual(snapshot.totals, {
    meetings: 1, complete: 1, nonterminal: 0, resumableFailure: 0, recoveryRequired: 0,
  });
});

test('reliability snapshot exposes sparse manifests and checkpoints', () => {
  const sparseParts = ['first', 'temporary', 'third'];
  delete sparseParts[1];
  const broken: MeetingRecord = {
    ...base,
    status: 'transcription_interrupted',
    segments: 3,
    segmentIds: [0, 2],
    tNext: 2,
    tParts: sparseParts,
    summary: '',
  };
  const snapshot = buildReliabilitySnapshot([broken]);
  assert.equal(snapshot.assertions.find(value => value.name === 'exact_segment_manifests')?.passed, false);
  assert.equal(snapshot.assertions.find(value => value.name === 'durable_resume_checkpoints')?.passed, false);
});

test('silent checkpoints are valid but sparse array holes are not', () => {
  const silent: MeetingRecord = {
    ...base, status: 'transcription_interrupted', tNext: 2, tParts: ['', 'speech'],
  };
  assert.equal(buildReliabilitySnapshot([silent]).assertions.find(value => value.name === 'durable_resume_checkpoints')?.passed, true);
});

test('diagnostic meeting metadata cannot leak meeting content', () => {
  const metadata = diagnosticMeetingMetadata(base);
  const serialized = JSON.stringify(metadata);
  assert.equal(serialized.includes('Secret title'), false);
  assert.equal(serialized.includes('Secret transcript'), false);
  assert.equal(serialized.includes('Secret summary'), false);
  assert.equal(serialized.includes('Secret action'), false);
  assert.equal(metadata.hasTranscript, true);
  assert.equal(metadata.hasSummary, true);
  assert.equal(metadata.actionItemCount, 1);
  assert.equal(metadata.transcriptChecksumPresent, true);
  assert.equal(serialized.includes(base.transcriptChecksum || ''), false, 'diagnostics expose checksum presence, not its value');
});

test('legacy statusless meetings are still audited as complete', () => {
  const legacy = { ...base, status: undefined, summary: '' };
  const snapshot = buildReliabilitySnapshot([legacy]);
  assert.equal(snapshot.totals.complete, 1);
  assert.equal(snapshot.assertions.find(value => value.name === 'complete_meetings_summarized')?.passed, false);
});
