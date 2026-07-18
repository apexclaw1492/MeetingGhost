import Anthropic from '@anthropic-ai/sdk';
import type { ActionItem } from './store';
import { parseStructuredSummary } from './fallbackIntelligence.ts';

/* ─── Summary templates ─── */

export const TEMPLATES = {
  general: {
    label: 'General Meeting',
    focus: 'key discussion points, decisions made, and action items',
  },
  standup: {
    label: 'Daily Standup',
    focus: 'what each person did, what they plan to do, and any blockers',
  },
  sales: {
    label: 'Sales Call',
    focus: 'customer needs, objections raised, pricing discussion, and next steps to close',
  },
  interview: {
    label: 'Interview',
    focus: "the candidate's experience, strengths, concerns, and hiring recommendation signals",
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

export function localSummaryPrompt(template: TemplateKey): string {
  const t = TEMPLATES[template] ?? TEMPLATES.general;
  return `You are MeetingGhost's careful local meeting analyst. Use ONLY facts in the supplied transcript or evidence packet, focusing on ${t.focus}.

Rules:
- Cover the beginning, middle, and end when temporal evidence is supplied.
- Do not invent names, deadlines, decisions, or tasks.
- A decision requires explicit agreement, approval, selection, or commitment by the group.
- An action item requires an explicit assignment or commitment. Do not convert questions, suggestions, conditional statements, general advice, scripture, or illustrative examples into tasks.
- Preserve the stated owner and deadline when present.
- Keep bullets concise and specific.

Reply with exactly these three sections and no preamble:
KEY POINTS:
- bullet list

DECISIONS:
- bullet list, or "None"

ACTION ITEMS:
- concrete tasks with owner/deadline, or "None"`;
}

/* Extract action items from a structured summary's ACTION ITEMS section */
export function parseActionItems(summary: string): ActionItem[] {
  return parseStructuredSummary(summary).actionItems.map(text => ({ text, done: false }));
}

/* ─── BYO-key Claude tier ─── */

export interface CloudSummary {
  title: string;
  summary: string;
  actionItems: ActionItem[];
}

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Concise 3-6 word meeting title' },
    key_points: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    action_items: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'key_points', 'decisions', 'action_items'],
  additionalProperties: false,
} as const;

export function chatSystemPrompt(): string {
  return `You are MeetingGhost's meeting assistant. Answer the user's question using ONLY the provided meeting excerpts. Quote or reference the relevant meeting when helpful. If the excerpts don't contain the answer, say so plainly.`;
}

export function chatUserPrompt(question: string, excerpts: { title: string; date: string; text: string }[]): string {
  const ctx = excerpts
    .map((e, i) => `[Excerpt ${i + 1} — "${e.title}" (${e.date})]\n${e.text}`)
    .join('\n\n');
  return `Meeting excerpts:\n\n${ctx}\n\nQuestion: ${question}`;
}

/* Ask a question against retrieved excerpts using the user's Claude key */
export async function askWithClaude(
  apiKey: string,
  question: string,
  excerpts: { title: string; date: string; text: string }[],
): Promise<string> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 2048,
    system: chatSystemPrompt(),
    messages: [{ role: 'user', content: chatUserPrompt(question, excerpts) }],
  });
  const block = response.content.find(b => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Empty response from Claude');
  return block.text;
}

/* One call returns title + structured summary + action items.
   Runs in the browser with the user's own key (BYO-key privacy model). */
export async function summarizeWithClaude(
  apiKey: string,
  transcript: string,
  template: TemplateKey,
): Promise<CloudSummary> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const t = TEMPLATES[template] ?? TEMPLATES.general;

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4096,
    system: `You are a professional meeting assistant. Analyze the meeting transcript, focusing on ${t.focus}.`,
    output_config: { format: { type: 'json_schema', schema: SUMMARY_SCHEMA } },
    messages: [{ role: 'user', content: transcript }],
  });

  const block = response.content.find(b => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Empty response from Claude');
  const data = JSON.parse(block.text);

  const section = (name: string, items: string[]) =>
    `${name}:\n${items.length ? items.map((i: string) => `- ${i}`).join('\n') : '- None'}`;
  const summary = [
    section('KEY POINTS', data.key_points),
    section('DECISIONS', data.decisions),
    section('ACTION ITEMS', data.action_items),
  ].join('\n\n');

  return {
    title: data.title,
    summary,
    actionItems: (data.action_items as string[]).map(text => ({ text, done: false })),
  };
}
