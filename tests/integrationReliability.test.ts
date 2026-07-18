import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFollowUpICS, buildMailto, createGitHubIssue } from '../src/utils/integrations.ts';
import type { MeetingRecord } from '../src/utils/store.ts';

function meeting(overrides: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id: 'handoff', date: 'Today', dur: 120, title: 'Reliability Review',
    transcript: 'Complete transcript', summary: 'Complete summary', status: 'complete',
    actionItems: [{ text: 'Verify the destination marker', done: false }],
    ...overrides,
  };
}

test('email draft generation never silently truncates a long summary or final action item', () => {
  const summaryMarker = 'FINAL-SUMMARY-MARKER-EMAIL';
  const actionMarker = 'FINAL-ACTION-MARKER-EMAIL';
  const mailto = buildMailto(meeting({
    summary: `${'Long complete summary. '.repeat(140)} ${summaryMarker}`,
    actionItems: [{ text: actionMarker, done: false }],
  }));
  assert.ok(mailto.length > 1800, 'fixture must cross the UI safe-mailto boundary');
  const query = mailto.slice(mailto.indexOf('?') + 1);
  const body = new URLSearchParams(query).get('body') || '';
  assert.match(body, new RegExp(summaryMarker));
  assert.match(body, new RegExp(actionMarker));
});

test('calendar follow-up retains complete summary and action markers', () => {
  const summaryMarker = 'FINAL-SUMMARY-MARKER-ICS';
  const actionMarker = 'FINAL-ACTION-MARKER-ICS';
  const ics = buildFollowUpICS(meeting({
    summary: `Decision retained through export ${summaryMarker}`,
    actionItems: [{ text: actionMarker, done: false }],
  }));
  assert.match(ics, new RegExp(summaryMarker));
  assert.match(ics, new RegExp(actionMarker));
  assert.match(ics, /END:VCALENDAR$/);
});

test('GitHub export has a terminal timeout instead of waiting forever', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  })) as typeof fetch;
  try {
    await assert.rejects(
      createGitHubIssue('token', 'owner/repo', meeting(), 5),
      /timed out.*Nothing was created/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
