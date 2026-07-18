import type { ActionItem, MeetingRecord } from './store';

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'been', 'before', 'being', 'between',
  'could', 'from', 'have', 'into', 'just', 'more', 'only', 'other', 'should', 'that',
  'their', 'there', 'these', 'they', 'this', 'those', 'through', 'very', 'what', 'when',
  'where', 'which', 'while', 'with', 'would', 'your', 'youre', 'were', 'will', 'then',
]);

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

export interface BasicSummary {
  title: string;
  summary: string;
  actionItems: ActionItem[];
}

/** Keep optional model requests bounded after a complete deterministic result exists. */
export function summaryEnhancementInput(transcript: string, completeFallback: string, maxChars = 12_000): string {
  return transcript.length > maxChars ? completeFallback : transcript;
}

/** Deterministic, dependency-free summary that works offline on every platform. */
export function createBasicSummary(transcript: string): BasicSummary {
  const all = sentences(transcript);
  if (!all.length) return { title: 'Untitled Meeting', summary: '', actionItems: [] };
  const frequency = new Map<string, number>();
  words(transcript).forEach(w => frequency.set(w, (frequency.get(w) || 0) + 1));
  const ranked = all.map((text, index) => {
    const tokens = words(text);
    return {
      text, index,
      score: tokens.reduce((sum, w) => sum + Math.min(frequency.get(w) || 0, 6), 0) / Math.max(5, tokens.length),
    };
  });
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
  const decisions = unique(all.filter(s => /\b(decid(?:e|ed)|agreed|approved|selected|chose|confirmed|will use)\b/i.test(s)), 4);
  const actionTexts = unique(all.filter(s =>
    /\b(action item|follow up|next step|need(?:s)? to|will|should|must|assigned|owner|due)\b/i.test(s),
  ), 6);
  const topTerms = [...frequency.entries()].sort((a, b) => b[1] - a[1]).map(([word]) => word)
    .filter(word => !/^\d+$/.test(word)).slice(0, 4);
  const title = topTerms.length ? topTerms.map(w => w[0].toUpperCase() + w.slice(1)).join(' ') : 'Meeting Notes';
  const section = (name: string, items: string[]) => `${name}:\n${items.length ? items.map(i => `- ${i}`).join('\n') : '- None identified'}`;
  return {
    title,
    summary: [section('KEY POINTS', keyPoints), section('DECISIONS', decisions), section('ACTION ITEMS', actionTexts)].join('\n\n'),
    actionItems: actionTexts.map(text => ({ text, done: false })),
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
