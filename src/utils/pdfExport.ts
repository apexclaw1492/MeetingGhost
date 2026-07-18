import { jsPDF } from 'jspdf';
import type { MeetingRecord } from './store';
import { formatDuration } from './time.ts';

/** Builds a paginated meeting PDF; long transcripts never run off one page. */
export function buildMeetingPdf(meeting: MeetingRecord): jsPDF {
  const doc = new jsPDF();
  let y = 20;
  const writeLines = (heading: string, body: string, newPage = false) => {
    if (newPage) { doc.addPage(); y = 20; }
    doc.setFontSize(14); doc.text(heading, 20, y); y += 9;
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(body || 'None.', 170) as string[];
    for (const line of lines) {
      if (y > 282) { doc.addPage(); y = 20; }
      doc.text(line, 20, y); y += 6;
    }
  };
  doc.setFontSize(18); doc.text(meeting.title || 'MeetingGhost Transcript', 20, y); y += 8;
  doc.setFontSize(10); doc.text(`${meeting.date} — duration ${formatDuration(meeting.dur)}`, 20, y); y += 12;
  writeLines('Summary', meeting.summary || 'No summary.');
  if (meeting.actionItems?.length) {
    y += 6;
    writeLines('Action Items', meeting.actionItems.map(item => `[${item.done ? 'x' : ' '}] ${item.text}`).join('\n'));
  }
  writeLines('Transcript', meeting.transcript || (meeting.status === 'complete' ? 'No speech was detected in this recording.' : 'Transcript not available.'), true);
  return doc;
}
