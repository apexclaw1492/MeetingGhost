import test from 'node:test';
import assert from 'node:assert/strict';
import { createBasicSummary, ensureMeetingSummary, mergeSearchSources, searchMeetingText, summaryEnhancementInput } from '../src/utils/fallbackIntelligence.ts';
import type { MeetingRecord } from '../src/utils/store.ts';
import { normalizedSegmentIds, segmentIdsFromKeys, segmentIdsFromNames } from '../src/utils/segmentManifest.ts';
import { formatDuration } from '../src/utils/time.ts';
import { meetingToMarkdown } from '../src/utils/integrations.ts';
import { compactMeetingRecords, transcriptIntegrity } from '../src/utils/meetingContent.ts';

test('creates useful structured meeting notes without an AI model', () => {
  const transcript = [
    'The team reviewed the mobile launch schedule and recording reliability.',
    'We decided to ship the recording recovery work before the visual refresh.',
    'Maya will follow up with the QA team by Friday.',
    'The launch schedule remains the main priority for the next sprint.',
  ].join(' ');
  const result = createBasicSummary(transcript);
  assert.match(result.summary, /KEY POINTS:/);
  assert.match(result.summary, /DECISIONS:/);
  assert.match(result.summary, /ACTION ITEMS:/);
  assert.match(result.summary, /decided to ship/i);
  assert.equal(result.actionItems.length, 1);
  assert.match(result.actionItems[0].text, /Maya will follow up/i);
  assert.notEqual(result.title, 'Untitled Meeting');
});

test('long repetitive summaries retain distinct middle and final meeting coverage', () => {
  const transcript = [
    'The meeting opened with reliability planning.',
    ...Array.from({ length: 30 }, (_, index) => `Status item ${index + 1} remains on schedule.`),
    'MIDDLE-COVERAGE. We decided to use durable native exports.',
    ...Array.from({ length: 30 }, (_, index) => `Status item ${index + 31} remains on schedule.`),
    'Maya will verify the shared artifact tomorrow with FINAL-COVERAGE.',
  ].join(' ');
  const result = createBasicSummary(transcript);
  const keyPoints = result.summary.split('\n\nDECISIONS:')[0];
  assert.match(keyPoints, /MIDDLE-COVERAGE/);
  assert.match(keyPoints, /FINAL-COVERAGE/);
  assert.equal((keyPoints.match(/remains on schedule/g) || []).length, 1);
});

test('multi-hour optional summary refinement uses the durable bounded fallback', () => {
  const transcript = 'opening context. '.repeat(20_000);
  const completeFallback = 'KEY POINTS:\n- opening\n- middle\n- final';
  const evidence = summaryEnhancementInput(transcript, completeFallback);
  assert.equal(evidence.length <= 12_000, true);
  assert.match(evidence, /TEMPORAL EVIDENCE FROM START THROUGH FINISH/);
  assert.match(evidence, /EXTRACTIVE BASELINE FROM THE COMPLETE MEETING/);
  assert.match(evidence, /KEY POINTS:\n- opening\n- middle\n- final/);
  assert.equal(summaryEnhancementInput('short transcript', completeFallback), 'short transcript');
});

test('complete transcript export restores a missing deterministic summary without replacing an existing one', () => {
  const transcript = [
    'The team opened with the reliability target.',
    'In the middle, everyone decided to retain every transcript checkpoint.',
    'Maya will verify the final export tomorrow.',
  ].join(' ');
  const meeting: MeetingRecord = {
    id: 'summary-repair', date: 'Today', dur: 120, title: 'Untitled Meeting',
    transcript, summary: '', status: 'complete',
  };
  const repaired = ensureMeetingSummary(meeting);
  assert.match(repaired.summary, /KEY POINTS:/);
  assert.match(repaired.summary, /DECISIONS:/);
  assert.match(repaired.summary, /ACTION ITEMS:/);
  assert.notEqual(repaired.title, 'Untitled Meeting');

  const existing = { ...meeting, summary: 'Carefully edited summary', title: 'Owner title' };
  assert.equal(ensureMeetingSummary(existing), existing);

  const interrupted = { ...meeting, summary: '', status: 'transcription_interrupted' as const };
  assert.equal(ensureMeetingSummary(interrupted), interrupted, 'partial transcripts are not summarized as complete meetings');
});

test('searches across saved transcripts without the semantic model', () => {
  const meetings: MeetingRecord[] = [
    { id: '1', date: 'Today', dur: 30, title: 'Launch Review', transcript: 'We approved the marketing budget for the autumn launch.', summary: '' },
    { id: '2', date: 'Yesterday', dur: 20, title: 'Hiring', transcript: 'The team discussed engineering interviews.', summary: '' },
  ];
  const hits = searchMeetingText(meetings, 'marketing budget');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, 'Launch Review');
  assert.match(hits[0].text, /marketing budget/i);
});

test('returns no false matches for unrelated questions', () => {
  const meetings: MeetingRecord[] = [
    { id: '1', date: 'Today', dur: 30, title: 'Launch Review', transcript: 'We approved the marketing budget.', summary: '' },
  ];
  assert.deepEqual(searchMeetingText(meetings, 'office catering'), []);
});

test('literal transcript matches cannot be crowded out by stale semantic hits', () => {
  const lexical = [{ title: 'Exact Meeting', date: 'Today', text: 'The launch code is ORBIT-742.' }];
  const semantic = Array.from({ length: 8 }, (_, index) => ({
    title: `Semantic ${index}`,
    date: 'Yesterday',
    text: `Related but non-literal excerpt ${index}`,
  }));
  const merged = mergeSearchSources(lexical, semantic, 5);
  assert.equal(merged.length, 5);
  assert.deepEqual(merged[0], lexical[0]);
});

test('preserves exact verified segments when a long recording has a write gap', () => {
  assert.deepEqual(segmentIdsFromNames(['seg-13', 'notes', 'seg-0', 'seg-12']), [0, 12, 13]);
  assert.deepEqual(segmentIdsFromKeys('meeting.1', [
    'meeting.1:seg:9', 'meeting.1:seg:2', 'other:seg:0', 'meeting.1:legacy',
  ]), [2, 9]);
  assert.deepEqual(normalizedSegmentIds([0, 2, 3], 4), [0, 2, 3]);
  assert.deepEqual(normalizedSegmentIds(undefined, 3), [0, 1, 2]);
  assert.deepEqual(normalizedSegmentIds([3, 1, 3, -1, 2.5, 0], 99), [0, 1, 3]);
});

test('bounds excerpts and summaries for punctuation-free long transcripts', () => {
  const longThought = Array.from({ length: 500 }, (_, i) => `budget topic${i}`).join(' ');
  const meeting: MeetingRecord = {
    id: 'long', date: 'Today', dur: 7200, title: 'Long Planning', transcript: longThought, summary: '',
  };
  const hits = searchMeetingText([meeting], 'budget');
  assert.equal(hits.length, 5);
  assert.equal(hits.every(hit => hit.text.length <= 600), true);
  const summary = createBasicSummary(longThought);
  assert.equal(summary.summary.length < 4000, true);
});

test('formats long recordings with an hours field', () => {
  assert.equal(formatDuration(59), '00:59');
  assert.equal(formatDuration(3599), '59:59');
  assert.equal(formatDuration(7205), '2:00:05');
});

test('exports complete hours-long meeting notes for another app', () => {
  const transcript = Array.from(
    { length: 5000 },
    (_, i) => `Transcript sentence ${i}: the team discussed launch reliability.`,
  ).join('\n');
  const meeting: MeetingRecord = {
    id: 'export-long',
    date: 'July 12, 2026 10:00 AM',
    dur: 7384,
    title: 'Reliability Review',
    summary: 'The team approved the long-recording reliability plan.',
    transcript,
    actionItems: [
      { text: 'Maya will run the physical background test.', done: false },
      { text: 'Alex verified the export pipeline.', done: true },
    ],
  };

  const markdown = meetingToMarkdown(meeting);
  assert.match(markdown, /^# Reliability Review/m);
  assert.match(markdown, /duration 2:03:04/);
  assert.match(markdown, /## Summary\nThe team approved/);
  assert.match(markdown, /- \[ \] Maya will run/);
  assert.match(markdown, /- \[x\] Alex verified/);
  assert.match(markdown, /Transcript sentence 4999:/);
  assert.equal(markdown.includes(transcript), true, 'the share file must not truncate the transcript');
});

test('keeps synchronous meeting metadata quota-safe after transcript archival', () => {
  const archived: MeetingRecord = {
    id: 'archived', date: 'Today', dur: 7200, title: 'Two Hours',
    transcript: 'large transcript '.repeat(100_000), summary: 'Saved summary',
    transcriptStored: true, status: 'complete', segments: 120,
    ...transcriptIntegrity('large transcript '.repeat(100_000)),
  };
  const active: MeetingRecord = {
    id: 'active', date: 'Today', dur: 60, title: 'In progress',
    transcript: 'must stay inline until archival succeeds', summary: '',
    transcriptStored: false, status: 'transcribing', segments: 1,
  };
  const compact = compactMeetingRecords([archived, active]);
  assert.equal(compact[0].transcript, '');
  assert.equal(compact[0].summary, 'Saved summary');
  assert.equal(compact[0].segments, 120);
  assert.equal(compact[1].transcript, active.transcript, 'unarchived text must never be discarded');
  assert.equal(compactMeetingRecords([archived])[0].transcriptStored, true);
});
