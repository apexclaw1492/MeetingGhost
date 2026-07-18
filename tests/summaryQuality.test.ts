import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createBasicSummary,
  refineSummarySafely,
  summaryEnhancementInput,
} from '../src/utils/fallbackIntelligence.ts';
import { localSummaryPrompt, parseActionItems } from '../src/utils/intelligence.ts';
import { scoreSummaryAgainstTruth, summaryQualityFixtures } from './summaryQualityFixtures.ts';

test('realistic synthetic meetings produce grounded summaries and assigned tasks', () => {
  for (const fixture of summaryQualityFixtures) {
    const result = createBasicSummary(fixture.transcript);
    const score = scoreSummaryAgainstTruth(result.summary, fixture.truth);
    assert.equal(score.total >= 75, true, `${fixture.id} scored ${score.total}: ${JSON.stringify(score)}`);
    assert.deepEqual(parseActionItems(result.summary), result.actionItems);
  }
});

test('tentative questions, conditional ideas, advice, and examples do not become tasks', () => {
  for (const fixture of summaryQualityFixtures) {
    const result = createBasicSummary(fixture.transcript);
    const actions = result.actionItems.map(item => item.text.toLowerCase()).join(' ');
    for (const forbidden of fixture.truth.forbiddenActions) {
      assert.equal(forbidden.every(term => actions.includes(term)), false, `${fixture.id} promoted ${forbidden.join(' ')} to a task`);
    }
  }
});

test('long-meeting model evidence is bounded and represents the complete timeline', () => {
  const transcript = [
    'START-MARKER. The team decided to begin with storage recovery.',
    ...Array.from({ length: 80 }, (_, index) => `Routine update ${index + 1} remained stable.`),
    'MIDDLE-MARKER. Maya will publish the recovery checklist by Friday.',
    ...Array.from({ length: 80 }, (_, index) => `Routine report ${index + 81} remained stable.`),
    'FINAL-MARKER. The group agreed that a missing final transcript blocks release.',
  ].join(' ');
  const fallback = createBasicSummary(transcript).summary;
  const evidence = summaryEnhancementInput(transcript.repeat(8), fallback, 12_000);
  assert.equal(evidence.length <= 12_000, true);
  assert.match(evidence, /EXTRACTIVE BASELINE FROM THE COMPLETE MEETING/);
  assert.match(evidence, /begin with storage recovery/);
  assert.match(evidence, /publish the recovery checklist by Friday/);
  assert.match(evidence, /missing final transcript blocks release/);
});

test('Gemma refinement keeps verified tasks and rejects ungrounded hallucinations', () => {
  const fixture = summaryQualityFixtures[0];
  const fallback = createBasicSummary(fixture.transcript);
  const evidence = summaryEnhancementInput(fixture.transcript, fallback.summary);
  const candidate = [
    'KEY POINTS:',
    '- The mobile launch review covered recording reliability and accessibility.',
    '- Store readiness depends on complete transcript evidence.',
    '',
    'DECISIONS:',
    '- The team selected September 24 for launch after the recording gate passes.',
    '',
    'ACTION ITEMS:',
    '- Maya will publish the rollback checklist by Friday.',
    '- Alex will update the settings screen by Friday.',
    '- Nina will order catering by Monday.',
  ].join('\n');
  const refined = refineSummarySafely(candidate, fallback.summary, evidence);
  assert.equal(refined.accepted, true);
  assert.match(refined.summary, /Maya will publish/i);
  assert.match(refined.summary, /Jordan will run/i);
  assert.match(refined.summary, /Priya will confirm/i);
  assert.doesNotMatch(refined.summary, /Alex will update the settings/i);
  assert.doesNotMatch(refined.summary, /Nina will order catering/i);
});

test('malformed or weak model output cannot replace the complete local summary', () => {
  const fixture = summaryQualityFixtures[1];
  const fallback = createBasicSummary(fixture.transcript);
  const refined = refineSummarySafely('A vague paragraph with no structured evidence.', fallback.summary, fixture.transcript);
  assert.equal(refined.accepted, false);
  assert.equal(refined.summary, fallback.summary);
  assert.deepEqual(refined.actionItems, fallback.actionItems);
});

test('the shipped local worker loads actual Gemma 3 with conservative generation', () => {
  const worker = fs.readFileSync(new URL('../src/workers/llm.worker.ts', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(worker, /gemma3-1b-it-q4f16_1-MLC/);
  assert.doesNotMatch(worker, /TinyLlama/);
  assert.match(worker, /temperature:\s*0\.2/);
  assert.match(worker, /seed:\s*42/);
  assert.match(app, /refineSummarySafely/);
  assert.match(localSummaryPrompt('general'), /Do not invent names, deadlines, decisions, or tasks/);
});
