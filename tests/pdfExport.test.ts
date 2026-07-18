import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMeetingPdf } from '../src/utils/pdfExport.ts';

test('long meeting PDF creates enough pages instead of clipping the transcript', () => {
  const transcript = Array.from({ length: 1200 }, (_, i) =>
    `Transcript sentence ${i + 1} records a decision, context, and follow-up owner for the long meeting.`,
  ).join(' ') + ' FINAL-TRANSCRIPT-MARKER-1200.';
  const doc = buildMeetingPdf({
    id: 'long-pdf', date: 'Today', dur: 7200, title: 'Two Hour Planning Meeting',
    transcript, summary: 'KEY POINTS:\n- Long planning discussion',
    actionItems: [{ text: 'Follow up after the meeting', done: false }],
  });
  assert.equal(doc.getNumberOfPages() > 20, true);
  assert.equal(doc.output('arraybuffer').byteLength > 100_000, true);
  const renderedPageCommands = ((doc.internal as unknown as { pages: string[][] }).pages || []).flat().join('\n');
  assert.match(renderedPageCommands, /FINAL-TRANSCRIPT-MARKER-1200/);
});
