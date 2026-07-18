import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleTranscriptParts, isPermanentNativeEngineFailure, safeResumeIndex, transcriptionStartGate } from '../src/utils/transcriptionState.ts';
import { assertMeetingTranscriptExportable, transcriptIntegrity } from '../src/utils/meetingContent.ts';

test('rewinds a sparse checkpoint instead of skipping a missing transcript section', () => {
  const sparse: string[] = [];
  sparse[0] = 'first';
  sparse[2] = 'third';
  assert.equal(safeResumeIndex(sparse, 3, 3), 1);
  assert.throws(() => assembleTranscriptParts(sparse, 3), /missing segment 2 of 3/);

  sparse[1] = ''; // an explicitly transcribed silent segment is valid
  assert.equal(safeResumeIndex(sparse, 3, 3), 3);
  assert.equal(assembleTranscriptParts(sparse, 3), 'first third');
});

test('blocks blank export while saved audio is still awaiting transcription', () => {
  assert.throws(() => assertMeetingTranscriptExportable({
    id: 'saved', date: 'Today', dur: 60, title: 'Pending', transcript: '', summary: '',
    status: 'transcription_interrupted', segments: 1,
  }), /transcription is not complete/);

  assert.throws(() => assertMeetingTranscriptExportable({
    id: 'partial', date: 'Today', dur: 60, title: 'Partial',
    transcript: 'only the first completed audio part', summary: '',
    status: 'transcription_interrupted', segments: 4, tNext: 1,
  }), /transcription is not complete/, 'a partial inline transcript must never authorize export');

  assert.doesNotThrow(() => assertMeetingTranscriptExportable({
    id: 'silent', date: 'Today', dur: 60, title: 'Silent', transcript: '', summary: '',
    status: 'complete', segments: 1, ...transcriptIntegrity(''),
  }));

  assert.throws(() => assertMeetingTranscriptExportable({
    id: 'ambiguous', date: 'Today', dur: 60, title: 'Ambiguous', transcript: '', summary: '',
    status: 'complete', segments: 1,
  }), /no verified transcript/, 'missing text must not be silently relabeled as no speech');
});

test('transcription preflight makes unavailable engines a terminal visible gate', () => {
  assert.equal(transcriptionStartGate({
    hasAudio: true,
    anotherTranscriptionActive: false,
    nativeEngineAvailable: false,
    whisperReady: false,
  }), 'model_unavailable');
  assert.equal(transcriptionStartGate({
    hasAudio: true,
    anotherTranscriptionActive: false,
    nativeEngineAvailable: true,
    whisperReady: false,
  }), 'start');
  assert.equal(transcriptionStartGate({
    hasAudio: true,
    anotherTranscriptionActive: false,
    nativeEngineAvailable: false,
    whisperReady: true,
  }), 'start', 'unsupported Android devices must retain the installed Whisper fallback');
});

test('Android disables native speech only for structural failures', () => {
  assert.equal(isPermanentNativeEngineFailure('The on-device English speech model is not installed.'), true);
  assert.equal(isPermanentNativeEngineFailure('Recognizer does not support verified saved-audio input.'), true);
  assert.equal(isPermanentNativeEngineFailure('Recognizer is busy; Retry resumes this checkpoint.'), false);
  assert.equal(isPermanentNativeEngineFailure('Native transcription exceeded its deadline.'), false);
});

test('two-hour Apple Speech resume preserves every completed one-minute checkpoint', () => {
  const total = 121;
  const parts: string[] = [];
  for (let index = 0; index < 79; index++) parts[index] = index === 25 ? '' : `minute-${index + 1}`;
  assert.equal(safeResumeIndex(parts, 79, total), 79, 'Retry starts after the last durable Apple Speech unit');

  for (let index = 79; index < total; index++) parts[index] = `minute-${index + 1}`;
  const complete = assembleTranscriptParts(parts, total);
  assert.match(complete, /^minute-1 /);
  assert.match(complete, /minute-121$/);
  assert.equal(complete.includes('minute-80'), true);
});
