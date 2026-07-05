import type { ReactNode } from 'react';

/* Words that signal commitments inside a meeting transcript */
const KEYWORDS = [
  'action item', 'action', 'follow up', 'follow-up', 'deadline', 'due',
  'todo', 'to-do', 'decision', 'decide', 'decided', 'assign', 'assigned',
  'schedule', 'scheduled', 'by friday', 'by monday', 'by tuesday',
  'by wednesday', 'by thursday', 'next week', 'next quarter', 'asap',
];

const pattern = new RegExp(`\\b(${KEYWORDS.map(k => k.replace(/[-\s]/g, '[-\\s]')).join('|')})\\b`, 'gi');

/* Wraps recognized keywords in <mark class="kw-mark">; plain text otherwise */
export function highlightKeywords(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(pattern)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    nodes.push(<mark className="kw-mark" key={i++}>{m[0]}</mark>);
    last = idx + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
