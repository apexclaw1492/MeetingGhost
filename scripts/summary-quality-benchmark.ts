import fs from 'node:fs';
import {
  createBasicSummary,
  parseStructuredSummary,
  refineSummarySafely,
  summaryEnhancementInput,
} from '../src/utils/fallbackIntelligence.ts';
import { localSummaryPrompt } from '../src/utils/intelligence.ts';
import { scoreSummaryAgainstTruth, summaryQualityFixtures } from '../tests/summaryQualityFixtures.ts';

const model = process.env.MEETINGGHOST_BENCHMARK_MODEL || 'gemma3:1b';
const endpoint = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/generate';

async function generateSummary(evidence: string): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      system: localSummaryPrompt('general'),
      prompt: `Meeting transcript or evidence packet:\n\n${evidence}`,
      stream: false,
      options: {
        temperature: 0.2,
        top_p: 0.9,
        seed: 42,
        num_predict: 900,
      },
    }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
  const payload = await response.json() as { response?: string };
  if (!payload.response?.trim()) throw new Error('Ollama returned an empty summary');
  return payload.response.trim();
}

function average(values: number[]): number {
  return Math.round((values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)) * 10) / 10;
}

const fixtureResults = [];
for (const fixture of summaryQualityFixtures) {
  const deterministic = createBasicSummary(fixture.transcript);
  const evidence = summaryEnhancementInput(fixture.transcript, deterministic.summary);
  const gemma = await generateSummary(evidence);
  const hybrid = refineSummarySafely(gemma, deterministic.summary, evidence);
  fixtureResults.push({
    fixture: fixture.id,
    deterministic: scoreSummaryAgainstTruth(deterministic.summary, fixture.truth),
    gemma: scoreSummaryAgainstTruth(gemma, fixture.truth),
    hybrid: scoreSummaryAgainstTruth(hybrid.summary, fixture.truth),
    hybridAccepted: hybrid.accepted,
    hybridReason: hybrid.reason,
  });
}

const result: Record<string, unknown> = {
  model,
  fixtureCount: fixtureResults.length,
  averages: {
    deterministic: average(fixtureResults.map(result => result.deterministic.total)),
    gemma: average(fixtureResults.map(result => result.gemma.total)),
    hybrid: average(fixtureResults.map(result => result.hybrid.total)),
  },
  fixtures: fixtureResults,
};

const phonePath = process.argv[2];
if (phonePath) {
  const bytes = fs.readFileSync(phonePath);
  const transcript = bytes.subarray(0, 8).toString('hex') === 'feffffff0e000000'
    ? bytes.subarray(8).toString('utf8')
    : bytes.toString('utf8');
  const deterministic = createBasicSummary(transcript);
  const evidence = summaryEnhancementInput(transcript, deterministic.summary);
  const gemma = await generateSummary(evidence);
  const hybrid = refineSummarySafely(gemma, deterministic.summary, evidence);
  const parsed = parseStructuredSummary(hybrid.summary);
  result.phoneMeeting = {
    transcriptCharacters: transcript.length,
    transcriptWords: transcript.split(/\s+/).filter(Boolean).length,
    evidenceCharacters: evidence.length,
    deterministicTitle: deterministic.title,
    deterministicActionCount: deterministic.actionItems.length,
    hybridAccepted: hybrid.accepted,
    hybridReason: hybrid.reason,
    hybridKeyPointCount: parsed.keyPoints.length,
    hybridDecisionCount: parsed.decisions.length,
    hybridActionCount: parsed.actionItems.length,
    hybridSummary: hybrid.summary,
  };
}

console.log(JSON.stringify(result, null, 2));
