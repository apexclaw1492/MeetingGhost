import type { ActionItem, MeetingRecord } from './store';

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'been', 'before', 'being', 'between',
  'could', 'from', 'have', 'into', 'just', 'more', 'only', 'other', 'should', 'that',
  'their', 'there', 'these', 'they', 'this', 'those', 'through', 'very', 'what', 'when',
  'where', 'which', 'while', 'with', 'would', 'your', 'youre', 'were', 'will', 'then',
  'actually', 'alright', 'anything', 'awesome', 'basically', 'cause', 'doing', 'dont',
  'feel', 'going', 'good', 'guess', 'know', 'like', 'little', 'look', 'maybe', 'mean',
  'okay', 'really', 'right', 'said', 'says', 'something', 'sure', 'thank', 'thing',
  'things', 'think', 'want', 'well', 'yeah', 'yes', 'back', 'come', 'didnt', 'even',
  'everybody', 'gonna', 'kind', 'people', 'pretty', 'saying', 'sometimes', 'talking',
  'thats', 'theres', 'time', 'wasnt',
]);

const TASK_VERBS = '(?:audit|book|build|call|confirm|contact|create|deliver|draft|email|file|finalize|follow up|invite|open|prepare|publish|register|release|report|review|run|schedule|send|share|ship|submit|test|update|upload|verify|write)';
const DEADLINE = '(?:by|before|on)\\s+(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\\s+week|[a-z]+\\s+\\d{1,2})';

function sentences(text: string): string[] {
  return (text.match(/[^.!?\n]+(?:[.!?]+|$)/g) || [])
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 12)
    .flatMap(s => {
      if (s.length <= 600) return [s];
      const chunks: string[] = [];
      let rest = s;
      while (rest.length > 600) {
        const splitAt = Math.max(300, rest.lastIndexOf(' ', 600));
        chunks.push(rest.slice(0, splitAt).trim());
        rest = rest.slice(splitAt).trim();
      }
      if (rest) chunks.push(rest);
      return chunks;
    });
}

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']{3,}/g) || [])
    .map(w => w.replace(/'/g, ''))
    .filter(w => !STOP_WORDS.has(w));
}

function unique(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function sentenceShape(text: string): string {
  return text.toLowerCase()
    .replace(/\b\d+(?:[.,]\d+)?\b/g, '#')
    .replace(/[^a-z#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decisionCandidate(text: string): boolean {
  if (/\?/.test(text) || /^\s*(?:if|maybe|perhaps)\b/i.test(text)) return false;
  if (/\bdecision\s*:/i.test(text)) return true;
  const group = '(?:we|the team|the board|the group|the committee|leadership|everyone)';
  const verb = '(?:decided|agreed|approved|confirmed|selected|chose|committed)';
  return new RegExp(`\\b${group}\\b.{0,100}\\b${verb}\\b|\\b${verb}\\b.{0,100}\\b${group}\\b`, 'i').test(text);
}

function actionCandidateScore(text: string): number {
  const lower = text.trim().toLowerCase();
  const explicit = /\b(?:action item|next step|assigned to|task owner)\b/i.test(text);
  if (!explicit && (/\?/.test(text) || /^(?:if|when|whenever|maybe|perhaps)\b/i.test(lower))) return 0;
  if (/\b(?:could|might|may)\b/i.test(text) && !/\b(?:agreed|assigned|committed)\b/i.test(text)) return 0;

  const ownerCommitment = new RegExp(`\\b[A-Z][a-z]{2,}(?:\\s+[A-Z][a-z]{2,})?\\s+(?:will|must|needs? to|is assigned to)\\s+${TASK_VERBS}\\b`).test(text);
  const speakerCommitment = new RegExp(`^\\s*[A-Z][a-z]{2,}(?:\\s+[A-Z][a-z]{2,})?:\\s+I\\s+(?:will|'ll|must|need to)\\s+${TASK_VERBS}\\b`, 'i').test(text);
  const firstPersonCommitment = new RegExp(`\\bI\\s+(?:will|'ll|must|need to)\\s+${TASK_VERBS}\\b`, 'i').test(text);
  const groupCommitment = new RegExp(`\\bwe\\s+(?:will|must|need to)\\s+${TASK_VERBS}\\b`, 'i').test(text);
  const hasTaskVerb = new RegExp(`\\b${TASK_VERBS}\\b`, 'i').test(text);
  const hasDeadline = new RegExp(`\\b${DEADLINE}\\b`, 'i').test(text);

  let score = explicit ? 5 : 0;
  if (ownerCommitment || speakerCommitment) score += 5;
  else if (firstPersonCommitment) score += 3;
  else if (groupCommitment) score += 2;
  if (hasTaskVerb) score += 2;
  if (hasDeadline) score += 2;
  return score;
}

function rankSentences(all: string[], frequency: Map<string, number>) {
  return all.map((text, index) => {
    const tokens = words(text);
    const uniqueTokens = new Set(tokens);
    const totalTokens = text.toLowerCase().match(/[a-z0-9']{3,}/g)?.length || 1;
    const contentRatio = tokens.length / totalTokens;
    let score = tokens.reduce((sum, word) => sum + Math.min(frequency.get(word) || 0, 6), 0) / Math.max(6, Math.sqrt(tokens.length || 1));
    score += uniqueTokens.size * 0.35 + contentRatio * 4;
    if (decisionCandidate(text)) score += 6;
    if (actionCandidateScore(text) >= 5) score += 6;
    if (/\b\d+(?::\d+)?\b/.test(text)) score += 1;
    if (tokens.length < 4 || contentRatio < 0.24) score -= 20;
    if (/^(?:yeah|yes|okay|right|well|wow|oh|uh|um)\b/i.test(text) && tokens.length < 8) score -= 12;
    return { text, index, score };
  });
}

function formatSection(name: string, items: string[]): string {
  return `${name}:\n${items.length ? items.map(item => `- ${item}`).join('\n') : '- None identified'}`;
}

export interface StructuredSummarySections {
  keyPoints: string[];
  decisions: string[];
  actionItems: string[];
  hasAllSections: boolean;
}

export function parseStructuredSummary(summary: string): StructuredSummarySections {
  const sections: Record<'KEY POINTS' | 'DECISIONS' | 'ACTION ITEMS', string[]> = {
    'KEY POINTS': [], DECISIONS: [], 'ACTION ITEMS': [],
  };
  let current: keyof typeof sections | null = null;
  const seen = new Set<keyof typeof sections>();
  for (const rawLine of summary.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^(KEY POINTS|DECISIONS|ACTION ITEMS)\s*:?\s*(.*)$/i);
    if (heading) {
      current = heading[1].toUpperCase() as keyof typeof sections;
      seen.add(current);
      const inline = heading[2].replace(/^[-*•]\s*/, '').trim();
      if (inline && !/^none\b/i.test(inline)) sections[current].push(inline);
      continue;
    }
    if (!current || !line) continue;
    const item = line.replace(/^[-*•\d.)\s]+/, '').trim();
    if (item && !/^none(?: identified)?\b/i.test(item)) sections[current].push(item);
  }
  return {
    keyPoints: sections['KEY POINTS'],
    decisions: sections.DECISIONS,
    actionItems: sections['ACTION ITEMS'],
    hasAllSections: seen.size === 3,
  };
}

function tokenSet(text: string): Set<string> {
  return new Set(words(text).filter(word => word.length >= 4));
}

function overlapRatio(left: string, right: string): number {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size) return 0;
  let overlap = 0;
  a.forEach(token => { if (b.has(token)) overlap += 1; });
  return overlap / a.size;
}

function grounded(item: string, evidence: string): boolean {
  const tokens = tokenSet(item);
  if (tokens.size < 2) return false;
  const evidenceTokens = tokenSet(evidence);
  let matches = 0;
  tokens.forEach(token => { if (evidenceTokens.has(token)) matches += 1; });
  return matches >= 2 && matches / tokens.size >= 0.35;
}

function groundedDecision(item: string, evidence: string): boolean {
  if (!decisionCandidate(item)) return false;
  return sentences(evidence).some(source => decisionCandidate(source)
    && overlapRatio(item, source) >= 0.4
    && overlapRatio(source, item) >= 0.25);
}

function groundedAction(item: string, evidence: string): boolean {
  if (actionCandidateScore(item) < 5) return false;
  return sentences(evidence).some(source => actionCandidateScore(source) >= 5
    && overlapRatio(item, source) >= 0.4
    && overlapRatio(source, item) >= 0.25);
}

function mergeGrounded(primary: string[], fallback: string[], limit: number): string[] {
  const merged: string[] = [];
  for (const item of [...primary, ...fallback]) {
    if (!item || merged.some(existing => overlapRatio(item, existing) >= 0.6 && overlapRatio(existing, item) >= 0.45)) continue;
    merged.push(item);
    if (merged.length >= limit) break;
  }
  return merged;
}

export interface BasicSummary {
  title: string;
  summary: string;
  actionItems: ActionItem[];
}

/** Deterministic, dependency-free summary that works offline on every platform. */
export function createBasicSummary(transcript: string): BasicSummary {
  const all = sentences(transcript);
  if (!all.length) return { title: 'Untitled Meeting', summary: '', actionItems: [] };
  const frequency = new Map<string, number>();
  words(transcript).forEach(w => frequency.set(w, (frequency.get(w) || 0) + 1));
  const ranked = rankSentences(all, frequency);
  // Long meetings often contain repeated status language. Pick the strongest
  // distinct sentence from each temporal third first, then fill remaining
  // slots globally. Numeric-only variations are treated as the same sentence
  // shape, preventing "item 1/item 2/item 3" from consuming every key point.
  const byScore = [...ranked].sort((a, b) => b.score - a.score);
  const selected: typeof ranked = [];
  const selectedShapes = new Set<string>();
  const addDistinct = (candidate: typeof ranked[number] | undefined) => {
    if (!candidate) return;
    const shape = sentenceShape(candidate.text);
    if (!shape || selectedShapes.has(shape)) return;
    selectedShapes.add(shape);
    selected.push(candidate);
  };
  for (let third = 0; third < 3; third++) {
    const start = Math.floor((all.length * third) / 3);
    const end = third === 2 ? all.length : Math.floor((all.length * (third + 1)) / 3);
    addDistinct(byScore.find(candidate => candidate.index >= start && candidate.index < end && !selectedShapes.has(sentenceShape(candidate.text))));
  }
  for (const candidate of byScore) {
    if (selected.length >= 5) break;
    addDistinct(candidate);
  }
  const keyPoints = selected.sort((a, b) => a.index - b.index).map(candidate => candidate.text);
  const decisions = unique(all.filter(decisionCandidate), 4);
  const actionTexts = unique(all
    .map(text => ({ text, score: actionCandidateScore(text) }))
    .filter(candidate => candidate.score >= 5)
    .sort((left, right) => right.score - left.score)
    .map(candidate => candidate.text), 8);
  const titleFrequency = new Map<string, number>();
  words([...keyPoints, ...decisions, ...actionTexts].join(' ')).forEach(word => titleFrequency.set(word, (titleFrequency.get(word) || 0) + 1));
  const topTerms = [...titleFrequency.entries()].sort((a, b) => b[1] - a[1]).map(([word]) => word)
    .filter(word => !/^\d+$/.test(word)).slice(0, 4);
  const title = topTerms.length ? topTerms.map(w => w[0].toUpperCase() + w.slice(1)).join(' ') : 'Meeting Notes';
  return {
    title,
    summary: [formatSection('KEY POINTS', keyPoints), formatSection('DECISIONS', decisions), formatSection('ACTION ITEMS', actionTexts)].join('\n\n'),
    actionItems: actionTexts.map(text => ({ text, done: false })),
  };
}

/**
 * Give a small local model evidence from the whole meeting instead of only the
 * opening or an opaque fallback. The extract stays bounded for mobile WebGPU.
 */
export function summaryEnhancementInput(transcript: string, completeFallback: string, maxChars = 12_000): string {
  if (transcript.length <= maxChars) return transcript;
  const all = sentences(transcript);
  const frequency = new Map<string, number>();
  words(transcript).forEach(word => frequency.set(word, (frequency.get(word) || 0) + 1));
  const ranked = rankSentences(all, frequency);
  const prefix = [
    'EXTRACTIVE BASELINE FROM THE COMPLETE MEETING:',
    completeFallback,
    '',
    'TEMPORAL EVIDENCE FROM START THROUGH FINISH:',
  ].join('\n');
  const excerpts: string[] = [];
  const shapes = new Set<string>();
  const windows = Math.min(6, all.length);
  const excerptBudget = Math.max(0, maxChars - prefix.length - windows * 14);
  const windowBudget = Math.max(120, Math.floor(excerptBudget / Math.max(1, windows)));
  for (let windowIndex = 0; windowIndex < windows; windowIndex++) {
    const start = Math.floor((all.length * windowIndex) / windows);
    const end = windowIndex === windows - 1 ? all.length : Math.floor((all.length * (windowIndex + 1)) / windows);
    const candidates = ranked
      .filter(candidate => candidate.index >= start && candidate.index < end)
      .sort((left, right) => right.score - left.score);
    const selected: typeof candidates = [];
    let used = 0;
    for (const candidate of candidates) {
      const shape = sentenceShape(candidate.text);
      if (!shape || shapes.has(shape)) continue;
      const cost = candidate.text.length + 3;
      if (selected.length && used + cost > windowBudget) continue;
      shapes.add(shape);
      selected.push(candidate);
      used += cost;
      if (selected.length >= 8 || used >= windowBudget) break;
    }
    if (!selected.length && candidates[0]) selected.push(candidates[0]);
    const ordered = selected.sort((left, right) => left.index - right.index);
    excerpts.push(`[Part ${windowIndex + 1}/${windows}]`);
    excerpts.push(...ordered.map(candidate => `- ${candidate.text}`));
  }
  const packet = [prefix, ...excerpts].join('\n');
  return packet.length <= maxChars ? packet : packet.slice(0, maxChars);
}

export interface SafeSummaryRefinement {
  summary: string;
  actionItems: ActionItem[];
  accepted: boolean;
  reason: string;
}

/** Reject malformed or ungrounded model output and retain verified fallback facts. */
export function refineSummarySafely(candidate: string, fallback: string, evidence: string): SafeSummaryRefinement {
  const model = parseStructuredSummary(candidate);
  const base = parseStructuredSummary(fallback);
  if (!model.hasAllSections) {
    return { summary: fallback, actionItems: base.actionItems.map(text => ({ text, done: false })), accepted: false, reason: 'missing structured sections' };
  }
  const groundedKeyPoints = model.keyPoints.filter(item => grounded(item, evidence));
  if (groundedKeyPoints.length < 2) {
    return { summary: fallback, actionItems: base.actionItems.map(text => ({ text, done: false })), accepted: false, reason: 'insufficient grounded key points' };
  }
  const verifiedDecisions = model.decisions.filter(item => groundedDecision(item, evidence));
  const verifiedActions = model.actionItems.filter(item => groundedAction(item, evidence));
  // The extractive baseline is the safety anchor. Model prose can add clarity
  // and topic coverage, but never displace facts or assignments copied from
  // the complete transcript.
  const keyPoints = mergeGrounded(base.keyPoints, groundedKeyPoints, 6);
  const decisions = mergeGrounded(base.decisions, verifiedDecisions, 5);
  const actionTexts = mergeGrounded(base.actionItems, verifiedActions, 8);
  const summary = [
    formatSection('KEY POINTS', keyPoints),
    formatSection('DECISIONS', decisions),
    formatSection('ACTION ITEMS', actionTexts),
  ].join('\n\n');
  return {
    summary,
    actionItems: actionTexts.map(text => ({ text, done: false })),
    accepted: true,
    reason: 'grounded model refinement merged with verified fallback',
  };
}

/** Ensure a complete transcript cannot be exported without its available offline summary. */
export function ensureMeetingSummary(meeting: MeetingRecord): MeetingRecord {
  const complete = !meeting.status || meeting.status === 'complete' || meeting.status === 'done';
  if (!complete || !meeting.transcript.trim() || meeting.summary.trim()) return meeting;
  const basic = createBasicSummary(meeting.transcript);
  if (!basic.summary) return meeting;
  const replaceDefaultTitle = !meeting.title.trim() || [
    'Untitled Meeting',
    'Imported Meeting',
    'Recovered Meeting',
  ].includes(meeting.title);
  return {
    ...meeting,
    title: replaceDefaultTitle ? basic.title : meeting.title,
    summary: basic.summary,
    actionItems: meeting.actionItems?.length ? meeting.actionItems : basic.actionItems,
  };
}

export interface LexicalHit { title: string; date: string; text: string; score: number; }
export interface SearchSource { title: string; date: string; text: string; }

/** Full-text fallback for Ask: no model, network, or GPU required. */
export function searchMeetingText(meetings: MeetingRecord[], query: string, limit = 5): LexicalHit[] {
  const terms = unique(words(query), 12);
  if (!terms.length) return [];
  const hits: LexicalHit[] = [];
  for (const meeting of meetings) {
    for (const text of sentences(meeting.transcript || '')) {
      const haystack = `${meeting.title || ''} ${text}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      if (score) hits.push({ title: meeting.title || 'Untitled Meeting', date: meeting.date, text, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Exact full-text results take precedence; optional semantic hits fill remaining slots. */
export function mergeSearchSources(
  lexical: SearchSource[],
  semantic: SearchSource[],
  limit = 5,
): SearchSource[] {
  const seen = new Set<string>();
  return [...lexical, ...semantic].filter(source => {
    const key = `${source.title}\u0000${source.date}\u0000${source.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, Math.max(0, limit));
}
