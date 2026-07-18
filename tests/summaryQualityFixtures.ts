import { parseStructuredSummary } from '../src/utils/fallbackIntelligence.ts';

export interface SummaryGroundTruth {
  topics: string[][];
  decisions: string[][];
  actions: string[][];
  forbiddenActions: string[][];
}

export interface SummaryQualityFixture {
  id: string;
  transcript: string;
  truth: SummaryGroundTruth;
}

const filler = Array.from({ length: 24 }, (_, index) =>
  `Status update ${index + 1}: the team reviewed routine metrics and noted that normal operations remain stable.`,
);

export const summaryQualityFixtures: SummaryQualityFixture[] = [
  {
    id: 'mobile-launch-review',
    transcript: [
      'Maya: We are reviewing the mobile launch, recording reliability, accessibility, and store readiness.',
      'The team decided to launch version 3 on September 24 after the locked-screen recording gate passes.',
      'We approved a twelve-thousand-dollar launch budget, with paid campaigns starting only after crash-free sessions exceed 99.5 percent.',
      'Maya will publish the rollback checklist by Friday.',
      'Jordan will run the VoiceOver and TalkBack audit by Thursday.',
      'Maybe we should redesign the entire settings screen someday, but no one accepted that suggestion.',
      'Could Alex help with screenshots if there is time?',
      ...filler.slice(0, 8),
      'Priya will confirm the App Store and Play Store metadata by Tuesday.',
      'If conversion drops, we might pause the campaign; this is a contingency, not an assigned task.',
      'The team agreed that a missing final transcript marker blocks release.',
    ].join(' '),
    truth: {
      topics: [['mobile', 'launch'], ['recording', 'reliability'], ['accessibility']],
      decisions: [['september', '24'], ['twelve', 'thousand'], ['final', 'transcript', 'release']],
      actions: [['maya', 'rollback', 'friday'], ['jordan', 'voiceover', 'thursday'], ['priya', 'store', 'metadata', 'tuesday']],
      forbiddenActions: [['alex', 'screenshots'], ['redesign', 'settings'], ['pause', 'campaign']],
    },
  },
  {
    id: 'enterprise-renewal',
    transcript: [
      'The account team met with Northstar Health about its annual renewal and security rollout.',
      'The board approved the renewal at eighty-four thousand dollars for twelve months.',
      'The team chose a phased rollout beginning with the analytics group.',
      'Elena will send the revised order form by Wednesday.',
      'Omar will schedule the security review before Friday.',
      'Someone said we should buy new laptops, but that was unrelated advice and not an assignment.',
      ...filler.slice(8, 16),
      'Kim will publish the migration FAQ by July 30.',
      'If legal objects, we could delay the signature; no delay was approved.',
      'The team confirmed that customer data must remain in the United States region.',
    ].join(' '),
    truth: {
      topics: [['northstar', 'renewal'], ['security', 'rollout'], ['customer', 'data']],
      decisions: [['eighty', 'four', 'thousand'], ['phased', 'rollout'], ['united', 'states']],
      actions: [['elena', 'order', 'form', 'wednesday'], ['omar', 'security', 'friday'], ['kim', 'migration', 'july', '30']],
      forbiddenActions: [['buy', 'laptops'], ['delay', 'signature']],
    },
  },
  {
    id: 'community-volunteer-planning',
    transcript: [
      'The neighborhood association reviewed volunteer scheduling, cleanup supplies, and the weekly signup update.',
      'The group agreed to use the VolunteerHub roster as the authoritative weekly schedule.',
      'Leadership approved a Saturday park cleanup and a Sunday food-pantry shift.',
      'Robert will register the volunteer team by Friday.',
      'Denise will send the safety briefing by Tuesday.',
      'People should share more often; this was general encouragement rather than a task.',
      ...filler.slice(16),
      'Marcus will upload the supply checklist before Sunday.',
      'If anyone needs a ride, I will go find someone, but no transportation owner was assigned.',
      'The group closed by reviewing the weather plan and emergency contacts.',
    ].join(' '),
    truth: {
      topics: [['volunteer', 'scheduling'], ['cleanup', 'supplies'], ['weather', 'emergency']],
      decisions: [['volunteerhub', 'authoritative'], ['saturday', 'park'], ['sunday', 'food', 'pantry']],
      actions: [['robert', 'volunteer', 'friday'], ['denise', 'safety', 'tuesday'], ['marcus', 'supply', 'sunday']],
      forbiddenActions: [['share', 'often'], ['transportation', 'owner'], ['find', 'someone']],
    },
  },
];

function normalized(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function containsAll(text: string, terms: string[]): boolean {
  const value = normalized(text);
  return terms.every(term => value.includes(normalized(term)));
}

function coverage(text: string, requirements: string[][]): number {
  if (!requirements.length) return 1;
  return requirements.filter(requirement => containsAll(text, requirement)).length / requirements.length;
}

export interface SummaryFixtureScore {
  total: number;
  structure: number;
  topicCoverage: number;
  decisionCoverage: number;
  actionCoverage: number;
  actionPrecision: number;
}

export function scoreSummaryAgainstTruth(summary: string, truth: SummaryGroundTruth): SummaryFixtureScore {
  const parsed = parseStructuredSummary(summary);
  const actionText = parsed.actionItems.join(' ');
  const structure = parsed.hasAllSections ? 10 : 0;
  const topicCoverage = coverage(summary, truth.topics) * 25;
  const decisionCoverage = coverage(parsed.decisions.join(' '), truth.decisions) * 25;
  const actionCoverage = coverage(actionText, truth.actions) * 30;
  const forbiddenFound = truth.forbiddenActions.filter(requirement => containsAll(actionText, requirement)).length;
  const actionPrecision = truth.forbiddenActions.length
    ? Math.max(0, 10 * (1 - forbiddenFound / truth.forbiddenActions.length))
    : 10;
  return {
    total: Math.round((structure + topicCoverage + decisionCoverage + actionCoverage + actionPrecision) * 10) / 10,
    structure,
    topicCoverage: Math.round(topicCoverage * 10) / 10,
    decisionCoverage: Math.round(decisionCoverage * 10) / 10,
    actionCoverage: Math.round(actionCoverage * 10) / 10,
    actionPrecision: Math.round(actionPrecision * 10) / 10,
  };
}
