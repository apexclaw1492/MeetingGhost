import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { deleteMeetingAudio, listStoredAudioManifests, readSegment, segmentNativeUri, writeSegment } from './audioStore.ts';
import { createBasicSummary, searchMeetingText } from './fallbackIntelligence.ts';
import { meetingToMarkdown } from './integrations.ts';
import { deleteMeetingContent, hydrateMeetingTranscripts, loadMeetingTranscript, saveMeetingTranscript } from './meetingContent.ts';
import { buildMeetingPdf } from './pdfExport.ts';
import type { MeetingRecord } from './store.ts';
import { log, logError } from './diag.ts';
import { withTimeout } from './async.ts';
import { prepareVerifiedNativeShareFile } from './nativeShareFile.ts';
import { resolvePlaybackSource } from './playbackSource.ts';

export interface IntegrityStep {
  name: string;
  passed: boolean;
  detail: string;
}

export interface IntelligenceIntegrityResult {
  version: 1;
  platform: string;
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  steps: IntegrityStep[];
}

export const INTEGRITY_START_MARKER = 'START-MARKER-ORBIT-742';
export const INTEGRITY_MIDDLE_MARKER = 'MIDDLE-MARKER-DELTA-315';
export const INTEGRITY_FINAL_MARKER = 'FINAL-MARKER-NEBULA-999';
const RESULT_KEY = 'mg_intelligence_integrity';

function buildTranscript(): string {
  const sentences = Array.from({ length: 2400 }, (_, index) => {
    if (index === 0) return `${INTEGRITY_START_MARKER}. The meeting opened with the reliability plan.`;
    if (index === 1200) return `${INTEGRITY_MIDDLE_MARKER} confirms we decided to approve the durable export plan.`;
    if (index === 2399) return `Maya will verify the final shared file tomorrow with ${INTEGRITY_FINAL_MARKER}.`;
    return `Integrity sentence ${index + 1} preserves the complete two-hour meeting context.`;
  });
  return sentences.join(' ');
}

/** A short, valid PCM WAV fixture exercises the same durable audio read/decode boundary as playback. */
function makeToneWav(durationSeconds = 0.3, sampleRate = 16_000): Blob {
  const sampleCount = Math.round(durationSeconds * sampleRate);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + sampleCount * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, sampleCount * 2, true);
  for (let index = 0; index < sampleCount; index++) {
    view.setInt16(44 + index * 2, Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 5000), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

async function playableDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      const duration = audio.duration;
      audio.removeAttribute('src');
      audio.load();
      if (error) reject(error);
      else resolve(Number.isFinite(duration) ? duration : 0);
    };
    const timer = window.setTimeout(() => finish(new Error('production playback metadata timed out')), 10_000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish();
    audio.onerror = () => finish(new Error('production playback URL could not be decoded'));
    audio.src = url;
    audio.load();
  });
}

function addStep(steps: IntegrityStep[], name: string, passed: boolean, detail: string): void {
  steps.push({ name, passed, detail });
  if (!passed) throw new Error(`${name}: ${detail}`);
}

/**
 * Runs on the device's real storage and audio-decoder boundary using synthetic
 * content only. It never inserts a test meeting into History and always cleans
 * up its temporary audio/transcript artifacts.
 */
export async function runIntelligenceIntegrityCheck(): Promise<IntelligenceIntegrityResult> {
  const startedAt = new Date().toISOString();
  const id = `integrity-${Date.now()}`;
  const steps: IntegrityStep[] = [];
  const nativeExportFiles: string[] = [];
  const transcript = buildTranscript();
  const baseMeeting: MeetingRecord = {
    id,
    date: 'Synthetic integrity check',
    dur: 7200,
    title: 'Integrity Reliability Review',
    transcript,
    summary: '',
    status: 'complete',
    audioKind: 'segments',
    segments: 1,
    segmentIds: [0],
    mimeType: 'audio/wav',
  };

  log('integrity.start', { id, chars: transcript.length });
  try {
    const sourceAudio = makeToneWav();
    await writeSegment(id, 0, sourceAudio);
    let objectUrl: string | null = null;
    const playbackSource = await resolvePlaybackSource({
      nativeSegmented: Capacitor.isNativePlatform(),
      loadNativeUri: () => segmentNativeUri(id, 0),
      convertNativeUri: uri => Capacitor.convertFileSrc(uri),
      loadBlob: () => readSegment(id, 0, 'audio/wav'),
      createObjectUrl: blob => {
        objectUrl = URL.createObjectURL(blob);
        return objectUrl;
      },
    });
    let decodedDuration = 0;
    try {
      decodedDuration = playbackSource ? await playableDuration(playbackSource.url) : 0;
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
    addStep(
      steps,
      'Production saved-audio playback boundary',
      !!playbackSource && decodedDuration >= 0.25,
      playbackSource
        ? `${Capacitor.isNativePlatform() ? 'Direct protected-file URL' : 'Bounded object URL'} decoded as ${decodedDuration.toFixed(3)}s audio.`
        : 'The production player could not resolve the verified audio file.',
    );

    const manifests = await withTimeout(
      listStoredAudioManifests(),
      30_000,
      'Storage-level recovery manifest scan timed out.',
    );
    const recoveredManifest = manifests.find(manifest => manifest.meetingId === id);
    addStep(
      steps,
      'Metadata-loss audio recovery',
      !!recoveredManifest && recoveredManifest.segmentIds.length === 1 &&
        recoveredManifest.segmentIds[0] === 0 && recoveredManifest.totalBytes === sourceAudio.size,
      recoveredManifest
        ? `Verified orphan scan found segment 0 and all ${recoveredManifest.totalBytes} audio bytes without History metadata.`
        : 'The verified audio file was not discoverable without meeting metadata.',
    );

    const transcriptMetadata = await saveMeetingTranscript(id, transcript);
    const [hydrated] = await hydrateMeetingTranscripts([{
      ...baseMeeting,
      transcript: '',
      transcriptStored: true,
      ...transcriptMetadata,
    }]);
    addStep(
      steps,
      'Transcript archive and hydration',
      hydrated.transcript === transcript && hydrated.transcriptChecksum === transcriptMetadata.transcriptChecksum,
      hydrated.transcript === transcript && hydrated.transcriptChecksum === transcriptMetadata.transcriptChecksum
        ? `${transcript.length} characters restored byte-for-byte with a matching whole-body fingerprint.`
        : 'Hydrated transcript differed from the complete source.',
    );

    const generated = createBasicSummary(hydrated.transcript);
    const meeting = { ...hydrated, title: generated.title, summary: generated.summary, actionItems: generated.actionItems };
    addStep(
      steps,
      'Whole-meeting private summary',
      generated.summary.includes(INTEGRITY_MIDDLE_MARKER) && generated.summary.includes(INTEGRITY_FINAL_MARKER),
      generated.summary.includes(INTEGRITY_MIDDLE_MARKER) && generated.summary.includes(INTEGRITY_FINAL_MARKER)
        ? 'Decision and final action markers survived deterministic summarization.'
        : 'The deterministic summary omitted a required whole-meeting marker.',
    );

    const unrelated: MeetingRecord = {
      id: `${id}-other`, date: 'Synthetic', dur: 30, title: 'Unrelated',
      transcript: 'A separate meeting discussed office furniture.', summary: '', status: 'complete',
    };
    const hits = searchMeetingText([unrelated, meeting], INTEGRITY_MIDDLE_MARKER, 5);
    addStep(
      steps,
      'Cross-conversation full-text search',
      hits.length > 0 && hits[0].title === meeting.title && hits[0].text.includes(INTEGRITY_MIDDLE_MARKER),
      hits.length > 0 ? `Exact marker returned from “${hits[0].title}”.` : 'Exact marker returned no result.',
    );

    const markdown = meetingToMarkdown(meeting);
    let markdownFileVerified = true;
    if (Capacitor.isNativePlatform()) {
      const markdownPath = `exports/${id}.md`;
      nativeExportFiles.push(markdownPath);
      await prepareVerifiedNativeShareFile({
        path: markdownPath, data: markdown, format: 'utf8', label: 'Markdown integrity',
      });
    }
    addStep(
      steps,
      'Complete Markdown artifact',
      markdown.includes(transcript) && markdown.endsWith(`${INTEGRITY_FINAL_MARKER}.`) && markdownFileVerified,
      markdown.endsWith(`${INTEGRITY_FINAL_MARKER}.`) && markdownFileVerified
        ? `${markdown.length} characters include the complete final transcript byte${Capacitor.isNativePlatform() ? ' and matched the native share file byte-for-byte' : ''}.`
        : 'Markdown did not end with the final transcript marker.',
    );

    const pdf = buildMeetingPdf(meeting);
    const pageCommands = ((pdf.internal as unknown as { pages: string[][] }).pages || []).flat().join('\n');
    const pdfDataUri = pdf.output('datauristring');
    const pdfBase64 = pdfDataUri.slice(pdfDataUri.indexOf(',') + 1);
    const pdfBytes = pdf.output('arraybuffer').byteLength;
    let pdfFileVerified = true;
    if (Capacitor.isNativePlatform()) {
      const pdfPath = `exports/${id}.pdf`;
      nativeExportFiles.push(pdfPath);
      await prepareVerifiedNativeShareFile({
        path: pdfPath, data: pdfBase64, format: 'base64', label: 'PDF integrity',
      });
    }
    addStep(
      steps,
      'Complete paginated PDF artifact',
      pdf.getNumberOfPages() > 2 && pdfBytes > 10_000 && pageCommands.includes(INTEGRITY_FINAL_MARKER) && pdfFileVerified,
      `${pdf.getNumberOfPages()} pages, ${pdfBytes} bytes; final transcript marker ${pageCommands.includes(INTEGRITY_FINAL_MARKER) ? 'present' : 'missing'}${Capacitor.isNativePlatform() ? `; native share file ${pdfFileVerified ? 'matched byte-for-byte' : 'did not match'}` : ''}.`,
    );
  } catch (error) {
    logError('integrity.fail', error, { id, step: steps.length + 1 });
    if (!steps.some(step => !step.passed)) {
      steps.push({ name: 'Integrity check execution', passed: false, detail: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    await Promise.allSettled([
      deleteMeetingAudio(id),
      deleteMeetingContent(id),
      ...nativeExportFiles.map(path => Filesystem.deleteFile({ path, directory: Directory.Cache })),
    ]);
  }

  try {
    const [remainingManifests, remainingTranscript, remainingExports] = await Promise.all([
      listStoredAudioManifests(),
      loadMeetingTranscript(id),
      Capacitor.isNativePlatform()
        ? Filesystem.readdir({ path: 'exports', directory: Directory.Cache })
        : Promise.resolve({ files: [] }),
    ]);
    const remainingSegments = remainingManifests.find(manifest => manifest.meetingId === id)?.segmentIds || [];
    const remainingExportFiles = remainingExports.files.filter(file => file.name.startsWith(id));
    steps.push({
      name: 'Synthetic artifact cleanup',
      passed: remainingSegments.length === 0 && remainingTranscript === '' && remainingExportFiles.length === 0,
      detail: remainingSegments.length === 0 && remainingTranscript === '' && remainingExportFiles.length === 0
        ? 'Temporary audio, transcript, and native export artifacts were removed; History was never modified.'
        : `${remainingSegments.length} temporary audio segment(s), ${remainingTranscript.length} transcript characters, or ${remainingExportFiles.length} export file(s) remained.`,
    });
  } catch (cleanupError) {
    steps.push({ name: 'Synthetic artifact cleanup', passed: false, detail: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) });
  }

  const result: IntelligenceIntegrityResult = {
    version: 1,
    platform: Capacitor.getPlatform(),
    startedAt,
    finishedAt: new Date().toISOString(),
    passed: steps.length === 8 && steps.every(step => step.passed),
    steps,
  };
  localStorage.setItem(RESULT_KEY, JSON.stringify(result));
  if (Capacitor.isNativePlatform()) {
    await Filesystem.writeFile({
      path: 'meeting-intelligence-integrity.json',
      data: JSON.stringify(result, null, 2),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    }).catch(error => logError('integrity.results.write.fail', error));
  }
  log('integrity.finished', { passed: result.passed, steps: steps.length });
  return result;
}

export function loadIntelligenceIntegrityResult(): IntelligenceIntegrityResult | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(RESULT_KEY) || 'null');
    return parsed?.version === 1 && Array.isArray(parsed.steps) ? parsed : null;
  } catch {
    return null;
  }
}
