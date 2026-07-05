import type { MeetingRecord } from './store';

/* ─── GitHub Issues ─── */

/* Creates one issue for the meeting with a task-list of action items. */
export async function createGitHubIssue(
  token: string,
  repo: string, // "owner/name"
  meeting: MeetingRecord,
): Promise<string> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repository must be in "owner/name" form.');
  const items = meeting.actionItems?.length
    ? meeting.actionItems.map(it => `- [${it.done ? 'x' : ' '}] ${it.text}`).join('\n')
    : '_No action items were extracted._';
  const body = [
    `## Action Items`, items, '',
    `## Summary`, meeting.summary || '_No summary._', '',
    `_Exported from MeetingGhost — ${meeting.date}_`,
  ].join('\n');

  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: `Meeting: ${meeting.title || 'Untitled Meeting'}`, body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub ${res.status}: ${err.message || res.statusText}`);
  }
  const issue = await res.json();
  return issue.html_url as string;
}

/* ─── Calendar (.ics) follow-up ─── */

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/* 30-minute follow-up event on the next weekday at 10:00 local time */
export function buildFollowUpICS(meeting: MeetingRecord): string {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  while (start.getDay() === 0 || start.getDay() === 6) start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  const items = meeting.actionItems?.map(it => `- ${it.text}`).join('\n') || '';
  const description = `Follow-up for "${meeting.title || 'Untitled Meeting'}" (${meeting.date})\n\n${items ? 'Action items:\n' + items + '\n\n' : ''}${meeting.summary || ''}`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MeetingGhost//EN',
    'BEGIN:VEVENT',
    `UID:mg-${meeting.id}@meetingghost.app`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(`Follow-up: ${meeting.title || 'Untitled Meeting'}`)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/* ─── Email draft ─── */

export function buildMailto(meeting: MeetingRecord): string {
  const items = meeting.actionItems?.map(it => `- ${it.done ? '[done] ' : ''}${it.text}`).join('\n') || '';
  const body = [
    `Meeting notes: ${meeting.title || 'Untitled Meeting'} (${meeting.date})`,
    '',
    meeting.summary || '',
    items ? `\nAction items:\n${items}` : '',
  ].join('\n').slice(0, 1800); // keep mailto URLs within safe length
  const subject = `Meeting notes: ${meeting.title || 'Untitled Meeting'}`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/* ─── Structured markdown (shared by MD export and share sheets) ─── */

export function meetingToMarkdown(meeting: MeetingRecord): string {
  const items = meeting.actionItems?.length
    ? meeting.actionItems.map(it => `- [${it.done ? 'x' : ' '}] ${it.text}`).join('\n')
    : null;
  return [
    `# ${meeting.title || 'MeetingGhost Transcript'}`,
    `*${meeting.date} — duration ${Math.floor(meeting.dur / 60)}m${meeting.dur % 60}s*`,
    '',
    '## Summary',
    meeting.summary || '_No summary._',
    ...(items ? ['', '## Action Items', items] : []),
    '',
    '## Transcript',
    meeting.transcript || '',
  ].join('\n');
}
