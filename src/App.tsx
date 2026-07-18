import { useState, useEffect, useRef } from 'react';
import { Share } from '@capacitor/share';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { App as CapApp } from '@capacitor/app';
import {
  Mic, Square, Loader2, Sparkles, Brain, Copy, Check,
  Share2, ShieldCheck, Trash2, Clock, Smartphone, Globe,
  Download, Award, Zap, HardDrive, CheckCircle2,
  Upload, FileText, Search, Folder as FolderIcon, FolderPlus,
  Highlighter, DatabaseBackup, X, Settings as SettingsIcon,
  KeyRound, ListChecks, MessageSquare, RefreshCw,
  CircleDot, CalendarPlus, Mail
} from 'lucide-react';
import goldBg from './assets/gold_bg.jpg';
import { getAudioData } from './utils/audio';
import { store, exportBackup, mergeBackup } from './utils/store';
import type { MeetingRecord, Folder, Settings } from './utils/store';
import { highlightKeywords } from './utils/highlight';
import { TEMPLATES, localSummaryPrompt, summarizeWithClaude, askWithClaude, chatSystemPrompt, chatUserPrompt } from './utils/intelligence';
import type { TemplateKey } from './utils/intelligence';
import { assertEmbeddingBatch, chunkTranscript, saveMeetingVectors, deleteMeetingVectors, indexedMeetingIds, indexableMeetingCount, searchVectors } from './utils/vectors';
import type { Chunk } from './utils/vectors';
import { createGitHubIssue, buildFollowUpICS, buildMailto, meetingToMarkdown } from './utils/integrations';
import { idb } from './utils/idb';
import { AudioPlayer } from './components/AudioPlayer';
import { SegmentedRecorder, SEGMENT_MS } from './utils/recorder';
import type { RecorderCallbacks } from './utils/recorder';
import { writeSegment, readSegment, segmentNativePath, listSegmentsOnDisk, listStoredAudioManifests, deleteMeetingAudio, freeBytes, STORAGE_WARN_BYTES, STORAGE_STOP_BYTES } from './utils/audioStore';
import { log as dlog, logError as dlogError, exportDiagnostics } from './utils/diag';
import { loadSelfTest, saveSelfTest, newSelfTest, makeTestStream, writeResultsFile, summarize } from './utils/selftest';
import type { SelfTestState } from './utils/selftest';
import { createBasicSummary, ensureMeetingSummary, mergeSearchSources, refineSummarySafely, searchMeetingText, summaryEnhancementInput } from './utils/fallbackIntelligence';
import { normalizedSegmentIds } from './utils/segmentManifest';
import { buildMeetingPdf } from './utils/pdfExport';
import { formatDuration } from './utils/time';
import { archiveMeetingTranscriptsSequentially, assertMeetingTranscriptExportable, assertTranscriptIntegrity, compactMeetingRecords, deleteMeetingContent, hydrateMeetingTranscripts, loadMeetingTranscript, saveMeetingTranscript, scanVerifiedMeetingTranscripts, transcriptIntegrity } from './utils/meetingContent';
import { RequestRegistry } from './utils/requestRegistry';
import { assembleTranscriptParts, isPermanentNativeEngineFailure, safeResumeIndex, transcriptionStartGate } from './utils/transcriptionState';
import { loadIntelligenceIntegrityResult, runIntelligenceIntegrityCheck } from './utils/intelligenceIntegrity';
import type { IntelligenceIntegrityResult } from './utils/intelligenceIntegrity';
import { withTimeout } from './utils/async';
import { audioChunkRanges, audioTimeChunkRanges } from './utils/audioChunks';
import { pcm16Base64ToFloat32 } from './utils/pcm';
import { NativeSegmentedRecorder, NATIVE_SEGMENT_SECONDS, stopOrphanedNativeRecording } from './utils/nativeRecorder';
import { prepareVerifiedNativeShareFile } from './utils/nativeShareFile';
import { recoveredImportPatch } from './utils/importRecovery';
import { recordingStartupRecovery } from './utils/recordingStartupRecovery';
import { acquireMicrophoneStream } from './utils/microphone';
import { ModelInitWatchdog } from './utils/modelInitWatchdog';
import type { ModelInitKind, ModelInitLimits, ModelInitTimeoutReason } from './utils/modelInitWatchdog';
import { deleteMeetingArtifacts } from './utils/deletionSafety';
import './App.css';

export const APP_VERSION = 'v12.27';

const SEMANTIC_INDEX_JOB_MAX_MS = 15 * 60_000;
const LIBRARY_SCAN_MAX_MS = 5 * 60_000;
const BACKUP_JOB_MAX_MS = 15 * 60_000;

function mergeHydratedMeetingContent(current: MeetingRecord, hydrated?: MeetingRecord): MeetingRecord {
  if (!hydrated) return current;
  // Never attach archive metadata to text that changed while the async read was
  // in flight. Otherwise merge only the transcript body and its integrity facts.
  if (current.transcript && hydrated.transcript && current.transcript !== hydrated.transcript) return current;
  const transcript = current.transcript || hydrated.transcript;
  if (!transcript && hydrated.transcriptOutcome !== 'no_speech') return current;
  return {
    ...current,
    transcript,
    transcriptOutcome: hydrated.transcriptOutcome,
    transcriptChars: hydrated.transcriptChars,
    transcriptBytes: hydrated.transcriptBytes,
    transcriptChecksum: hydrated.transcriptChecksum,
  };
}

function hasUnavailableCompletedTranscript(meeting: MeetingRecord): boolean {
  const complete = !meeting.status || meeting.status === 'complete' || meeting.status === 'done';
  return complete && !meeting.transcript && meeting.transcriptOutcome !== 'no_speech';
}

interface NativeSTTAvailability {
  available: boolean;
  engine?: string;
  maxChunkMs?: number;
  reason?: string;
  modelDownloadAvailable?: boolean;
}

/* Native on-device transcription. Apple Speech owns iOS inference; Android
   13+ uses a support-checked on-device SpeechRecognizer file-audio pipe.
   Whisper-WASM remains the web and unsupported-Android fallback. */
const NativeSTT = registerPlugin<{
  available(): Promise<NativeSTTAvailability>;
  info(options: { path: string }): Promise<{ durationMs: number; bytes: number; engine?: string }>;
  cancel(): Promise<{ canceled: boolean }>;
  transcribeFile(options: { path: string; startMs?: number; durationMs?: number }): Promise<{
    text: string;
    engine?: string;
    startMs?: number;
    durationMs?: number;
  }>;
}>('NativeSTT');

const NativeAudioDecoder = registerPlugin<{
  available(): Promise<{ available: boolean; engine?: string; maxChunkMs?: number }>;
  info(options: { path: string }): Promise<{ durationMs: number; bytes: number; engine?: string }>;
  decodeChunk(options: { path: string; startMs: number; durationMs: number }): Promise<{
    pcm16Base64: string;
    sampleRate: number;
    channels: number;
    samples: number;
    durationMs: number;
    startMs: number;
    engine?: string;
  }>;
}>('NativeAudioDecoder');

const NativeAudioImport = registerPlugin<{
  pick(options: { meetingId: string }): Promise<{
    bytes: number;
    mimeType: string;
    displayName: string;
    segmentId: number;
  }>;
  addListener(eventName: 'progress', listener: (event: {
    meetingId: string;
    phase: 'copying' | 'finalizing' | 'failed';
    bytes: number;
  }) => void): Promise<{ remove(): Promise<void> }>;
}>('NativeAudioImport');

interface Model {
  name: string;
  size: string;
  done: boolean;
  loading: boolean;
  progress: number;
  error?: string;
}

/* WebGPU is required by the WebLLM summarizer; absent on most iOS/Android WebViews */
const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

const WEB_TRANSCRIBE_CHUNK_SAMPLES = 16_000 * 60 * 5; // five bounded minutes at Whisper's 16 kHz input
const ANDROID_NATIVE_DECODE_CHUNK_MS = 60_000;
const IOS_NATIVE_STT_CHUNK_MS = 60_000;
const MODEL_INIT_LIMITS: Record<ModelInitKind, ModelInitLimits> = {
  whisper: { idleMs: 120_000, hardMs: 15 * 60_000 },
  gemma: { idleMs: 180_000, hardMs: 20 * 60_000 },
  embed: { idleMs: 120_000, hardMs: 10 * 60_000 },
};

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ─── App ─── */
export function App() {
  const [hasOnboarded, setHasOnboarded] = useState(true);
  const [recording, setRecording] = useState(false);
  const [time, setTime] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [summary, setSummary] = useState('');
  const [processing, setProcessing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const meetingsRef = useRef<MeetingRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [tab, setTab] = useState<'studio' | 'history' | 'ask' | 'models' | 'settings'>('studio');
  const [askQuery, setAskQuery] = useState('');
  const [askAnswer, setAskAnswer] = useState('');
  const [askSources, setAskSources] = useState<{ title: string; date: string; text: string }[]>([]);
  const [askBusy, setAskBusy] = useState(false);
  const [askProgress, setAskProgress] = useState('');
  const [indexedCount, setIndexedCount] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState('');
  const [historySearchMatches, setHistorySearchMatches] = useState<Set<string>>(new Set());
  const [historySearchState, setHistorySearchState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [historySearchError, setHistorySearchError] = useState('');
  const [historySearchProgress, setHistorySearchProgress] = useState({ completed: 0, total: 0 });
  const [historySearchRetry, setHistorySearchRetry] = useState(0);
  const [transcriptLoadingIds, setTranscriptLoadingIds] = useState<Set<string>>(new Set());
  const [backupBusy, setBackupBusy] = useState<'export' | 'import' | null>(null);
  const [backupProgress, setBackupProgress] = useState('');
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>('all');
  const [settings, setSettings] = useState<Settings>(() => store.loadSettings());
  const [notice, setNotice] = useState('');

  const [whisper, setWhisper] = useState<Model>({
    name: 'Whisper Voice-to-Text', size: '141 MB', done: false, loading: false, progress: 0
  });
  const [gemma, setGemma] = useState<Model>({
    name: 'Gemma 3 Summarizer', size: '~700 MB runtime', done: false, loading: false, progress: 0
  });
  const [embedder, setEmbedder] = useState<Model>({
    name: 'Semantic Search Engine', size: '25 MB', done: false, loading: false, progress: 0
  });

  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const onboardingButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsRef = useRef<Settings>(settings);
  useEffect(() => { settingsRef.current = settings; store.saveSettings(settings); }, [settings]);

  useEffect(() => {
    if (!hasOnboarded) onboardingButtonRef.current?.focus();
  }, [hasOnboarded]);

  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      setHistorySearchMatches(new Set());
      setHistorySearchState('idle');
      setHistorySearchError('');
      setHistorySearchProgress({ completed: 0, total: 0 });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const matches = new Set<string>();
      setHistorySearchState('loading');
      setHistorySearchError('');
      setHistorySearchProgress({ completed: 0, total: meetingsRef.current.length });
      void scanVerifiedMeetingTranscripts(meetingsRef.current, meeting => {
        if (meeting.transcript.toLowerCase().includes(query)) matches.add(meeting.id);
      }, {
        signal: controller.signal,
        maxDurationMs: LIBRARY_SCAN_MAX_MS,
        onProgress: (completed, total) => setHistorySearchProgress({ completed, total }),
      }).then(() => {
        if (controller.signal.aborted) return;
        setHistorySearchMatches(matches);
        setHistorySearchState('idle');
      }).catch(searchError => {
        if (controller.signal.aborted) return;
        setHistorySearchMatches(new Set());
        setHistorySearchState('error');
        setHistorySearchError(searchError instanceof Error ? searchError.message : String(searchError));
      });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort(new Error('A newer History search replaced this scan.'));
    };
  }, [searchQuery, meetings, historySearchRetry]);

  /* Audio Visualizer Refs */
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  /* AI Worker Refs */
  const whisperWorkerRef = useRef<Worker | null>(null);
  const llmWorkerRef = useRef<Worker | null>(null);
  const embedWorkerRef = useRef<Worker | null>(null);
  const embedRequestsRef = useRef<Map<number, { resolve: (v: number[][]) => void; reject: (e: Error) => void }>>(new Map());
  const embedRequestSeqRef = useRef(0);
  const indexAbortRef = useRef<AbortController | null>(null);
  const backupAbortRef = useRef<AbortController | null>(null);
  const embedderStateRef = useRef<Model>(embedder);
  const modelInitWatchdogRef = useRef(new ModelInitWatchdog());
  const modelInitStartRef = useRef<((kind: ModelInitKind) => void) | null>(null);
  const chatRequestsRef = useRef(new RequestRegistry<string>());
  const summaryRequestsRef = useRef<Map<number, { meetingId: string; timer: number; fallback: string; evidence: string }>>(new Map());
  const summaryRequestSeqRef = useRef(0);
  const [audioIds, setAudioIds] = useState<Set<string>>(new Set());
  const [procStatus, setProcStatus] = useState('');
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  useEffect(() => { embedderStateRef.current = embedder; }, [embedder]);

  /* v10 reliability: segmented recorder + resumable transcription queue */
  const recorderRef = useRef<SegmentedRecorder | NativeSegmentedRecorder | null>(null);
  const startingRecordingRef = useRef(false);
  const transcribeRequestsRef = useRef(new RequestRegistry<string>());
  const queueFlagsRef = useRef<{ cancel: boolean; pause: boolean }>({ cancel: false, pause: false });
  const transcribingIdRef = useRef<string | null>(null);
  const [storageInfo, setStorageInfo] = useState<{ freeMB: number; estMin: number | null } | null>(null);
  const [savedFlash, setSavedFlash] = useState(''); // "recording safely saved" confirmation
  const [selfTest, setSelfTest] = useState<SelfTestState | null>(null);
  const selfTestBusyRef = useRef(false);
  const [integrityBusy, setIntegrityBusy] = useState(false);
  const [integrityResult, setIntegrityResult] = useState<IntelligenceIntegrityResult | null>(() => loadIntelligenceIntegrityResult());
  const autostartHandledRef = useRef(false);
  const [nativeSTT, setNativeSTT] = useState<NativeSTTAvailability | null>(null);
  const nativeSTTRef = useRef<NativeSTTAvailability | null>(null);
  const nativeAudioDecoderRef = useRef<{ available: boolean; engine?: string; maxChunkMs?: number } | null>(null);
  useEffect(() => { nativeSTTRef.current = nativeSTT; }, [nativeSTT]);

  /* Current recording tracking */
  const currentMeetingRef = useRef<{ id: string, date: string, dur: number } | null>(null);
  const whisperStateRef = useRef<Model>(whisper);
  const gemmaStateRef = useRef<Model>(gemma);
  const transcriptRef = useRef('');
  const summaryRef = useRef('');

  useEffect(() => { whisperStateRef.current = whisper; }, [whisper]);
  useEffect(() => { gemmaStateRef.current = gemma; }, [gemma]);

  /* Persist / restore */
  useEffect(() => {
    const modelInitWatchdog = modelInitWatchdogRef.current;
    let whisperWasDone = false;
    let gemmaWasDone = false;
    let embedderWasDone = false;
    let autoResumeTimer: number | undefined;
    const nativeRecovery = Capacitor.isNativePlatform()
      ? withTimeout(
          stopOrphanedNativeRecording(),
          30_000,
          'Native recording recovery timed out; reopen the app before starting another recording.',
        ).catch(error => {
          dlogError('recover.native.stop.fail', error);
          return null;
        })
      : Promise.resolve(null);
    try {
      if (!localStorage.getItem('mg_onb')) {
        setHasOnboarded(false);
      }
      const h = localStorage.getItem('mg_h');
      if (h) {
        // Reconstruct correct states after crash/force-quit/reload/restart.
        // Legacy v9 statuses normalize; in-flight states become recoverable.
        const loaded: MeetingRecord[] = JSON.parse(h).map((m: MeetingRecord) => {
          const audioKind = m.audioKind || (m.segments ? 'segments' : 'single');
          const segmentIds = normalizedSegmentIds(m.segmentIds, m.segments || 0);
          switch (m.status) {
            case 'done': return { ...m, audioKind, segmentIds, status: 'complete' as const };
            case 'processing': case 'error':
              return { ...m, audioKind, segmentIds, status: 'transcription_interrupted' as const, recovered: m.status === 'processing' };
            case 'queued': case 'transcribing':
              return { ...m, audioKind, segmentIds, status: 'transcription_interrupted' as const, recovered: true };
            case 'recording':
              // Reconciled against segments on disk below (async)
              return { ...m, audioKind, segmentIds, status: 'recovery_required' as const, recovered: true };
            default: return { ...m, audioKind, segmentIds };
          }
        });
        localStorage.setItem('mg_h', JSON.stringify(compactMeetingRecords(loaded)));
        meetingsRef.current = loaded;
        setMeetings(loaded);

        // Keep archived transcript bodies out of launch memory. History loads
        // one body when the user asks to view it; search and semantic indexing
        // scan verified archives one at a time. This avoids rendering an entire
        // hours-long library into one WebView while preserving fail-closed use.

        // One-time migration for existing full transcripts. The compact flag
        // is written only after the IDB body is written and read back exactly.
        const legacyBodies = loaded.filter(m => !!m.transcript && !m.transcriptStored);
        if (legacyBodies.length) {
          void archiveMeetingTranscriptsSequentially(legacyBodies, {
            releaseVerifiedBodies: true,
            maxDurationMs: BACKUP_JOB_MAX_MS,
            onArchiveError: (migrationError, meeting) => {
              dlogError('meeting.content.migrate.fail', migrationError, { id: meeting.id });
            },
            onProgress: (_completed, _total, archived) => {
              if (!archived.transcriptStored) return;
              const current = meetingsRef.current.find(meeting => meeting.id === archived.id);
              if (!current?.transcript || transcriptIntegrity(current.transcript).transcriptChecksum !== archived.transcriptChecksum) return;
              updateMeeting(archived.id, {
                transcript: '',
                transcriptStored: true,
                transcriptOutcome: archived.transcriptOutcome,
                transcriptChars: archived.transcriptChars,
                transcriptBytes: archived.transcriptBytes,
                transcriptChecksum: archived.transcriptChecksum,
              });
            },
          }).catch(migrationError => {
            dlogError('meeting.content.migrate.stop', migrationError);
            setError(`Saved transcript migration stopped safely: ${migrationError instanceof Error ? migrationError.message : String(migrationError)} Complete inline transcripts were retained; reopen the app to retry.`);
          });
        }

        // Native capture may outlive a WebView reload. Finalize that orphaned
        // session once before reconciling disk so its last valid partial is
        // either atomically committed or discarded, never transcribed corrupt.
        // Disk reconciliation: a meeting killed mid-recording keeps every
        // segment that was flushed+verified; only the in-flight tail can be missing.
        loaded.filter(m => m.status === 'recovery_required').forEach(async (m) => {
          const recoveredNative = await nativeRecovery;
          if (recoveredNative?.meetingId === m.id) {
            dlog('recover.native.finalized', {
              id: m.id,
              segments: recoveredNative.segmentIds?.length || 0,
              bytes: recoveredNative.totalBytes || 0,
            });
          }
          let segmentIds: number[];
          try {
            segmentIds = await withTimeout(
              listSegmentsOnDisk(m.id),
              30_000,
              'Recovery timed out while checking saved audio. Reopen the app and use Retry in History.',
            );
          } catch (e) {
            updateMeeting(m.id, { diag: e instanceof Error ? e.message : String(e) });
            dlogError('recover.recording.list.fail', e, { id: m.id });
            return;
          }
          dlog('recover.recording', { id: m.id, segsOnDisk: segmentIds.length, segmentIds: segmentIds.join(','), segsBelieved: m.segments || 0 });
          if (segmentIds.length > 0) {
            const nativeDetails = recoveredNative?.meetingId === m.id ? recoveredNative : null;
            updateMeeting(m.id, {
              segments: segmentIds.length,
              segmentIds,
              bytes: Math.max(m.bytes || 0, nativeDetails?.totalBytes || 0),
              dur: Math.max(m.dur || 0, Math.round((nativeDetails?.recordedMs || 0) / 1000)),
              mimeType: nativeDetails?.mimeType || m.mimeType || 'audio/mp4',
              status: 'transcription_interrupted',
              diag: nativeDetails?.error
                ? `Recovered after native interruption: ${nativeDetails.error} ${segmentIds.length} committed audio segment(s) were preserved.`
                : `Recovered after interruption: ${segmentIds.length} audio segment(s) preserved. Up to ${Capacitor.isNativePlatform() ? NATIVE_SEGMENT_SECONDS : Math.round(SEGMENT_MS / 1000)}s of trailing audio may be missing.`,
            });
            setAudioIds(prev => new Set(prev).add(m.id));
            setNotice('A recording interrupted by an app shutdown was recovered — see History.');
            setTimeout(() => setNotice(''), 8000);
          } else {
            updateMeeting(m.id, {
              diag: 'The app was terminated before any audio segment could be written. No audio survived.',
            });
          }
        });

        // Auto-resume an interrupted transcription (max 2 automatic attempts —
        // a deterministic crash must not loop; manual Retry is always there).
        const resumable = loaded.find(m =>
          m.status === 'transcription_interrupted' && (m.retries || 0) < 2 &&
          (m.segments || 0) > 0 && !m.transcript);
        if (resumable && !loadSelfTest()?.running) {
          const attemptAutoResume = () => {
            const fresh = (JSON.parse(localStorage.getItem('mg_h') || '[]') as MeetingRecord[]).find(x => x.id === resumable.id);
            if (fresh && fresh.status === 'transcription_interrupted' &&
                (nativeSTTRef.current?.available || whisperStateRef.current.done) && !transcribingIdRef.current) {
              setNotice('Resuming the interrupted transcription automatically — your audio is safe either way.');
              setTimeout(() => setNotice(''), 7000);
              void retryTranscription(fresh);
            } else if (fresh?.status === 'transcription_interrupted' && whisperStateRef.current.loading) {
              // Re-warm may still be reading the cached model. Follow it until
              // its own terminal watchdog resolves ready or failed; never
              // silently abandon an otherwise resumable saved recording.
              autoResumeTimer = window.setTimeout(attemptAutoResume, 2000);
            } else if (fresh?.status === 'transcription_interrupted' && whisperStateRef.current.error) {
              setNotice(`Saved transcription is ready to resume after the model is retried: ${whisperStateRef.current.error}`);
              setTimeout(() => setNotice(''), 9000);
            }
          };
          autoResumeTimer = window.setTimeout(attemptAutoResume, 8000); // let the cached model re-warm first
        }
      }
      setFolders(store.loadFolders());
      // Normalize any persisted mid-download state (loading can never survive a reload)
      const w = localStorage.getItem('mg_w');
      if (w) {
        const wp = { ...JSON.parse(w), loading: false };
        whisperWasDone = !!wp.done;
        setWhisper(wp); whisperStateRef.current = wp;
      }
      const g = localStorage.getItem('mg_g');
      if (g) {
        const gp = { ...JSON.parse(g), loading: false };
        gemmaWasDone = !!gp.done;
        setGemma(gp); gemmaStateRef.current = gp;
      }
      const em = localStorage.getItem('mg_e');
      if (em) {
        const ep = { ...JSON.parse(em), loading: false };
        embedderWasDone = !!ep.done;
        setEmbedder(ep); embedderStateRef.current = ep;
      }
    } catch { /* noop */ }

    // Metadata is not the final authority for saved audio. Rebuild a visible
    // History shell for any verified segment directory/IDB manifest that
    // survived while localStorage was cleared or corrupted.
    void nativeRecovery.then(async nativeDetails => {
      const manifests = await withTimeout(
        listStoredAudioManifests(),
        30_000,
        'Saved-audio recovery scan did not complete within 30 seconds.',
      );
      let recoveredCount = 0;
      for (const manifest of manifests) {
        if (meetingsRef.current.some(meeting => meeting.id === manifest.meetingId)) continue;
        const timestamp = Number(manifest.meetingId);
        const recoveredDate = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp) : new Date();
        const matchedNative = nativeDetails?.meetingId === manifest.meetingId ? nativeDetails : null;
        save({
          id: manifest.meetingId,
          date: recoveredDate.toLocaleDateString() + ' ' + recoveredDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          dur: Math.round((matchedNative?.recordedMs || 0) / 1000),
          title: 'Recovered Meeting',
          transcript: '',
          summary: '',
          status: 'transcription_interrupted',
          audioKind: 'segments',
          segments: manifest.segmentIds.length,
          segmentIds: manifest.segmentIds,
          bytes: Math.max(manifest.totalBytes, matchedNative?.totalBytes || 0),
          mimeType: matchedNative?.mimeType || 'audio/mp4',
          recovered: true,
          diag: 'Recovered verified audio after meeting metadata was missing. Review playback, then tap Retry Transcription.',
        });
        setAudioIds(previous => new Set(previous).add(manifest.meetingId));
        recoveredCount++;
        dlog('recover.audio.orphan', { id: manifest.meetingId, segments: manifest.segmentIds.length, bytes: manifest.totalBytes });
      }
      if (recoveredCount > 0) {
        setNotice(`${recoveredCount} saved recording${recoveredCount === 1 ? '' : 's'} recovered into History.`);
        setTimeout(() => setNotice(''), 10_000);
      }
    }).catch(error => {
      dlogError('recover.audio.scan.fail', error);
      setError(`Saved-audio recovery needs attention: ${error instanceof Error ? error.message : String(error)}`);
    });

    // Initialize Web Workers
    whisperWorkerRef.current = new Worker(new URL('./workers/whisper.worker.ts', import.meta.url), { type: 'module' });
    llmWorkerRef.current = new Worker(new URL('./workers/llm.worker.ts', import.meta.url), { type: 'module' });
    embedWorkerRef.current = new Worker(new URL('./workers/embed.worker.ts', import.meta.url), { type: 'module' });

    function modelState(kind: ModelInitKind): Model {
      if (kind === 'whisper') return whisperStateRef.current;
      if (kind === 'gemma') return gemmaStateRef.current;
      return embedderStateRef.current;
    }

    function commitModelState(kind: ModelInitKind, next: Model, persist = false): void {
      if (kind === 'whisper') {
        whisperStateRef.current = next;
        setWhisper(next);
      } else if (kind === 'gemma') {
        gemmaStateRef.current = next;
        setGemma(next);
      } else {
        embedderStateRef.current = next;
        setEmbedder(next);
      }
      if (persist) {
        const key = kind === 'whisper' ? 'mg_w' : kind === 'gemma' ? 'mg_g' : 'mg_e';
        localStorage.setItem(key, JSON.stringify(next));
      }
    }

    function replaceModelWorker(kind: ModelInitKind): void {
      if (kind === 'whisper') {
        whisperWorkerRef.current?.terminate();
        const replacement = new Worker(new URL('./workers/whisper.worker.ts', import.meta.url), { type: 'module' });
        replacement.onmessage = handleWhisperMessage;
        replacement.onerror = handleWhisperError;
        whisperWorkerRef.current = replacement;
      } else if (kind === 'gemma') {
        llmWorkerRef.current?.terminate();
        const replacement = new Worker(new URL('./workers/llm.worker.ts', import.meta.url), { type: 'module' });
        replacement.onmessage = handleLlmMessage;
        replacement.onerror = handleLlmError;
        llmWorkerRef.current = replacement;
      } else {
        embedWorkerRef.current?.terminate();
        const replacement = new Worker(new URL('./workers/embed.worker.ts', import.meta.url), { type: 'module' });
        replacement.onmessage = handleEmbedMessage;
        replacement.onerror = handleEmbedError;
        embedWorkerRef.current = replacement;
      }
    }

    function failModel(kind: ModelInitKind, detail: string): void {
      modelInitWatchdog.cancel(kind);
      const failed = { ...modelState(kind), loading: false, done: false, error: detail };
      commitModelState(kind, failed, true);
      if (kind === 'whisper') {
        transcribeRequestsRef.current.rejectAll(new Error(detail));
      } else if (kind === 'gemma') {
        chatRequestsRef.current.rejectAll(new Error(detail));
        summaryRequestsRef.current.forEach(context => clearTimeout(context.timer));
        summaryRequestsRef.current.clear();
      } else {
        embedRequestsRef.current.forEach(request => request.reject(new Error(detail)));
        embedRequestsRef.current.clear();
      }
      replaceModelWorker(kind);
      dlogError(`worker.${kind}.terminal`, detail);
      const noticeText = kind === 'whisper'
        ? `${detail} Saved audio was not changed; retry the model, then resume transcription.`
        : kind === 'gemma'
          ? `${detail} Complete private summaries and full-text search remain available.`
          : `${detail} Full-text search remains available; retry Improve Search when convenient.`;
      setNotice(noticeText);
      setTimeout(() => setNotice(''), 9000);
    }

    function startModelInit(kind: ModelInitKind): void {
      if (modelInitWatchdog.isActive(kind)) return;
      const worker = kind === 'whisper' ? whisperWorkerRef.current : kind === 'gemma' ? llmWorkerRef.current : embedWorkerRef.current;
      if (!worker) {
        failModel(kind, 'The model worker was unavailable.');
        return;
      }
      commitModelState(kind, { ...modelState(kind), loading: true, done: false, progress: 0, error: undefined });
      const initId = modelInitWatchdog.begin(kind, MODEL_INIT_LIMITS[kind], (reason: ModelInitTimeoutReason) => {
        const detail = reason === 'stalled'
          ? `${modelState(kind).name} stopped making progress and was restarted.`
          : `${modelState(kind).name} exceeded its maximum preparation time and was restarted.`;
        failModel(kind, detail);
      });
      try {
        worker.postMessage({ type: 'init', initId });
      } catch (error) {
        failModel(kind, `${modelState(kind).name} could not start: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    modelInitStartRef.current = startModelInit;

    function handleEmbedMessage(e: MessageEvent) {
      const { status, progress, requestId, vectors, message, operation, initId } = e.data;
      if (status === 'progress') {
        if (!modelInitWatchdog.progress('embed', initId)) return;
        commitModelState('embed', { ...embedderStateRef.current, loading: true, done: false, progress, error: undefined });
      } else if (status === 'ready') {
        if (!modelInitWatchdog.finish('embed', initId)) return;
        commitModelState('embed', { ...embedderStateRef.current, loading: false, done: true, progress: 100, error: undefined }, true);
      } else if (status === 'embedded') {
        embedRequestsRef.current.get(requestId)?.resolve(vectors);
        embedRequestsRef.current.delete(requestId);
      } else if (status === 'error') {
        if (operation === 'init') {
          if (!modelInitWatchdog.isCurrent('embed', initId)) return;
          failModel('embed', `Semantic Search Engine could not start: ${message || 'unknown error'}`);
        } else if (requestId !== undefined) {
          embedRequestsRef.current.get(requestId)?.reject(new Error(message));
          embedRequestsRef.current.delete(requestId);
        }
      }
    }
    embedWorkerRef.current.onmessage = handleEmbedMessage;

    function handleWhisperMessage(e: MessageEvent) {
      const { status, progress, text, message, current, total, requestId, operation, initId } = e.data;
      if (status === 'progress') {
        if (!modelInitWatchdog.progress('whisper', initId)) return;
        commitModelState('whisper', { ...whisperStateRef.current, loading: true, done: false, progress, error: undefined });
      } else if (status === 'ready') {
        if (!modelInitWatchdog.finish('whisper', initId)) return;
        commitModelState('whisper', { ...whisperStateRef.current, loading: false, done: true, progress: 100, error: undefined }, true);
      } else if (status === 'transcribe_progress') {
        setProcStatus(prev => {
          const seg = prev.match(/^Transcribing (\d+\/\d+)/)?.[1];
          return `Transcribing ${seg || ''} — ${Math.round((current / total) * 100)}%`.replace('  ', ' ');
        });
      } else if (status === 'complete') {
        if (!transcribeRequestsRef.current.resolve(requestId, text)) {
          dlog('worker.whisper.stale', { requestId });
        }
      } else if (status === 'error') {
        if (operation === 'init') {
          if (!modelInitWatchdog.isCurrent('whisper', initId)) return;
          failModel('whisper', `Whisper Voice-to-Text could not start: ${message || 'unknown error'}`);
        } else if (operation === 'transcribe' && typeof requestId === 'number') {
          transcribeRequestsRef.current.reject(requestId, new Error(message));
        }
      }
    }
    whisperWorkerRef.current.onmessage = handleWhisperMessage;

    // A crashed worker must surface, never hang the queue forever
    function handleWhisperError(e: ErrorEvent) {
      failModel('whisper', `Transcription worker crashed: ${e.message || 'unknown error'}`);
    }
    whisperWorkerRef.current.onerror = handleWhisperError;

    function handleLlmMessage(e: MessageEvent) {
      const { status, progress, text, message, requestId, operation, initId } = e.data;
      if (status === 'progress') {
        if (!modelInitWatchdog.progress('gemma', initId)) return;
        commitModelState('gemma', { ...gemmaStateRef.current, loading: true, done: false, progress, error: undefined });
      } else if (status === 'ready') {
        if (!modelInitWatchdog.finish('gemma', initId)) return;
        commitModelState('gemma', { ...gemmaStateRef.current, loading: false, done: true, progress: 100, error: undefined }, true);
      } else if (status === 'complete') {
        const context = summaryRequestsRef.current.get(requestId);
        if (!context) {
          dlog('worker.llm.stale', { requestId, operation: 'summarize' });
          return;
        }
        const refinement = refineSummarySafely(text, context.fallback, context.evidence);
        updateMeeting(context.meetingId, { summary: refinement.summary, actionItems: refinement.actionItems });
        dlog('worker.llm.summary.quality', { requestId, accepted: refinement.accepted, reason: refinement.reason });
        if (currentMeetingRef.current?.id === context.meetingId) {
          setSummary(refinement.summary);
          summaryRef.current = refinement.summary;
        }
        llmWorkerRef.current?.postMessage({ type: 'autoTitle', requestId, text: refinement.summary });
      } else if (status === 'chat_complete') {
        if (!chatRequestsRef.current.resolve(requestId, text)) {
          dlog('worker.llm.stale', { requestId, operation: 'chat' });
        }
      } else if (status === 'title_complete') {
        const context = summaryRequestsRef.current.get(requestId);
        if (!context) {
          dlog('worker.llm.stale', { requestId, operation: 'autoTitle' });
          return;
        }
        updateMeeting(context.meetingId, { title: text });
        clearTimeout(context.timer);
        summaryRequestsRef.current.delete(requestId);
      } else if (status === 'error') {
        if (operation === 'init') {
          if (!modelInitWatchdog.isCurrent('gemma', initId)) return;
          failModel('gemma', `Gemma 3 Summarizer could not start: ${message || 'unknown error'}`);
        } else if (operation === 'chat' && typeof requestId === 'number') {
          chatRequestsRef.current.reject(requestId, new Error(message || 'AI answer failed'));
        } else if ((operation === 'summarize' || operation === 'autoTitle') && typeof requestId === 'number') {
          // The deterministic summary was committed before optional refinement;
          // discard only this failed refinement and never touch another meeting.
          const context = summaryRequestsRef.current.get(requestId);
          if (context) clearTimeout(context.timer);
          summaryRequestsRef.current.delete(requestId);
          if (context && currentMeetingRef.current?.id === context.meetingId) {
            setNotice(`AI enhancement unavailable (${message || 'unknown error'}) — the complete private summary was kept.`);
            setTimeout(() => setNotice(''), 5000);
          }
        } else {
          failModel('gemma', `Meeting AI failed: ${message || 'unknown error'}`);
        }
      }
    }
    llmWorkerRef.current.onmessage = handleLlmMessage;

    function handleLlmError(e: ErrorEvent) {
      failModel('gemma', `Meeting AI worker crashed: ${e.message || 'unknown error'}`);
    }
    llmWorkerRef.current.onerror = handleLlmError;

    function handleEmbedError(e: ErrorEvent) {
      failModel('embed', `Search worker crashed: ${e.message || 'unknown error'}`);
    }
    embedWorkerRef.current.onerror = handleEmbedError;

    // Models persisted as installed are cached by the browser — re-warm the
    // workers so transcription/summarization actually work after a reload.
    // Native STT probe: a verified native engine replaces Whisper-WASM on iOS
    // and supported Android 13+ devices. Whisper still warms as the Android/web
    // fallback when the OS cannot prove saved-audio recognition support.
    let nativeSTTAvailable = false;
    const warmWhisper = () => {
      if (whisperWasDone && !nativeSTTAvailable) startModelInit('whisper');
    };
    if (Capacitor.isNativePlatform()) {
      withTimeout(
        NativeSTT.available(),
        5_000,
        'Native speech capability check timed out; preparing the saved-audio fallback.',
      )
        .then(res => {
          nativeSTTAvailable = !!res.available;
          setNativeSTT(res);
          nativeSTTRef.current = res;
          dlog('nativestt.probe', { ...res });
          warmWhisper();
        })
        .catch(error => {
          const fallback = { available: false, reason: error instanceof Error ? error.message : String(error) };
          setNativeSTT(fallback);
          nativeSTTRef.current = fallback;
          dlogError('nativestt.probe.fail', error);
          warmWhisper();
        });
    } else {
      warmWhisper();
    }
    if (Capacitor.getPlatform() === 'android') {
      withTimeout(
        NativeAudioDecoder.available(),
        5_000,
        'Native Android audio decoder capability check timed out.',
      )
        .then(result => {
          nativeAudioDecoderRef.current = result;
          dlog('nativeaudio.probe', { ...result });
        })
        .catch(error => {
          nativeAudioDecoderRef.current = { available: false };
          dlogError('nativeaudio.probe.fail', error);
        });
    }
    if (gemmaWasDone && hasWebGPU) startModelInit('gemma');
    if (embedderWasDone) startModelInit('embed');

    indexedMeetingIds(store.loadMeetings()).then(ids => setIndexedCount(ids.size)).catch(() => { /* noop */ });
    // Playable audio: legacy IDB blobs/segments AND meetings with verified segments
    idb.keys('audio').then(keys => setAudioIds(prev => {
      const n = new Set(prev);
      keys.forEach(k => n.add(String(k).split(':')[0]));
      try {
        (JSON.parse(localStorage.getItem('mg_h') || '[]') as MeetingRecord[])
          .filter(m => normalizedSegmentIds(m.segmentIds, m.segments || 0).length > 0)
          .forEach(m => n.add(m.id));
      } catch { /* noop */ }
      return n;
    })).catch(() => { /* noop */ });

    /* iOS lifecycle: flush the in-flight segment BEFORE the WebView can be
       suspended, so backgrounding/locking loses nothing already spoken. */
    const onVisibility = () => {
      dlog(document.visibilityState === 'hidden' ? 'app.hidden' : 'app.visible');
      if (document.visibilityState === 'hidden') recorderRef.current?.flushCurrent();
    };
    const onPageHide = () => { dlog('app.pagehide'); recorderRef.current?.flushCurrent(); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (recorderRef.current?.isActive) { e.preventDefault(); recorderRef.current.flushCurrent(); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    let appListener: { remove: () => void } | undefined;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('appStateChange', ({ isActive }) => {
        dlog('app.state', { isActive });
        if (!isActive) recorderRef.current?.flushCurrent();
        else if (recorderRef.current instanceof NativeSegmentedRecorder) {
          void withTimeout(
            recorderRef.current.reconcile(),
            10_000,
            'Native recorder status did not respond after returning to the app.',
          ).catch(error => dlogError('rec.native.reconcile.fail', error));
        }
      }).then(l => { appListener = l; }).catch(() => { /* noop */ });
    }
    dlog('app.launch', { version: APP_VERSION, platform: Capacitor.getPlatform() });

    // Test automation: native side fires this when launched with MG_SELFTEST=1.
    // Starts a FRESH run — any stale persisted run is stopped and replaced.
    // detail: { secs, cycles, ladder } from MG_SELFTEST_SECS/CYCLES/LADDER.
    const onSelfTestAutostart = (e: Event) => {
      if (autostartHandledRef.current) return; // once per app process
      autostartHandledRef.current = true;
      const detail = (e as CustomEvent).detail || {};
      const secs = Number(detail.secs) > 0 ? Number(detail.secs) : 20;
      const cycles = Number(detail.cycles) > 0 ? Number(detail.cycles) : 25;
      const ladder = Array.isArray(detail.ladder) && detail.ladder.length ? detail.ladder.map(Number) : undefined;
      dlog('selftest.autostart', { secs, cycles, ladder: ladder?.join(',') });
      const cur = loadSelfTest();
      if (cur?.running) { cur.running = false; saveSelfTest(cur); }
      const begin = () => {
        if (selfTestBusyRef.current) { window.setTimeout(begin, 3000); return; }
        const st = newSelfTest(cycles, secs, new Date().toISOString(), ladder);
        saveSelfTest(st);
        setSelfTest(st);
        void runSelfTest(st);
      };
      window.setTimeout(begin, 1500);
    };
    window.addEventListener('mg-selftest-autostart', onSelfTestAutostart);

    // Self-test resume: a relaunch while a run was active IS a kill-recovery
    // test — count it and continue from the persisted cursor.
    let selfTestTimer: number | undefined;
    const stLoaded = loadSelfTest();
    if (stLoaded?.running) {
      stLoaded.kills += 1;
      saveSelfTest(stLoaded);
      setSelfTest(stLoaded);
      dlog('selftest.resumed_after_kill', { cycle: stLoaded.cycle, kills: stLoaded.kills });
      selfTestTimer = window.setTimeout(() => { void runSelfTest(stLoaded); }, 4000);
    } else if (stLoaded) {
      setSelfTest(stLoaded);
    }

    const pendingTranscriptions = transcribeRequestsRef.current;
    const pendingAnswers = chatRequestsRef.current;
    const pendingSummaries = summaryRequestsRef.current;
    return () => {
      pendingTranscriptions.rejectAll(new Error('Application closed during transcription.'));
      pendingAnswers.rejectAll(new Error('Application closed during AI answer generation.'));
      pendingSummaries.forEach(context => clearTimeout(context.timer));
      pendingSummaries.clear();
      indexAbortRef.current?.abort(new Error('Application closed during semantic indexing. Completed meeting indexes were kept.'));
      indexAbortRef.current = null;
      backupAbortRef.current?.abort(new Error('Application closed during backup processing. Verified transcript archives and inline backup content were kept.'));
      backupAbortRef.current = null;
      modelInitWatchdog.cancelAll();
      modelInitStartRef.current = null;
      whisperWorkerRef.current?.terminate();
      llmWorkerRef.current?.terminate();
      embedWorkerRef.current?.terminate();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      appListener?.remove();
      window.removeEventListener('mg-selftest-autostart', onSelfTestAutostart);
      if (selfTestTimer !== undefined) clearTimeout(selfTestTimer);
      if (autoResumeTimer !== undefined) clearTimeout(autoResumeTimer);
    };
  // Worker/lifecycle registration is intentionally process-mount-only; the
  // called pipelines read current state through refs and durable storage.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* localStorage is written SYNCHRONOUSLY (it is the durable source of truth
     the recovery/queue logic reads via getMeeting) — React state follows.
     Persisting inside the batched state updater caused a race where code
     right after updateMeeting() read stale data and silently bailed. */
  const persistMeetingList = (u: MeetingRecord[]) => {
    meetingsRef.current = u;
    localStorage.setItem('mg_h', JSON.stringify(compactMeetingRecords(u)));
    setMeetings(u);
  };

  const save = (r: MeetingRecord) => {
    const base = meetingsRef.current.length ? meetingsRef.current : store.loadMeetings();
    const u = [r, ...base.filter(m => m.id !== r.id)];
    persistMeetingList(u);
  };

  const updateMeeting = (id: string, patch: Partial<MeetingRecord>) => {
    const base = meetingsRef.current.length ? meetingsRef.current : store.loadMeetings();
    const u = base.map(m => m.id === id ? { ...m, ...patch } : m);
    persistMeetingList(u);
  };

  /* ─── v10 transcription queue ───
     A separate, resumable stage that operates ONLY on already-saved audio.
     One segment at a time (bounded memory), checkpointed after every segment,
     resumable from tNext after any interruption. Failure never touches audio. */

  const getMeeting = (id: string): MeetingRecord | undefined => {
    const current = meetingsRef.current.find(x => x.id === id);
    if (current) return current;
    try { return (JSON.parse(localStorage.getItem('mg_h') || '[]') as MeetingRecord[]).find(x => x.id === id); }
    catch { return undefined; }
  };

  const transcribeFloat32 = (audio: Float32Array): Promise<string> => {
    const worker = whisperWorkerRef.current;
    if (!worker) return Promise.reject(new Error('Transcription worker is unavailable.'));
    const request = transcribeRequestsRef.current.create(300_000, 'transcription stalled (5-minute timeout)');
    // Transfer (not copy) the buffer — matters on memory-tight WebViews.
    worker.postMessage({ type: 'transcribe', requestId: request.requestId, audio }, [audio.buffer]);
    return request.promise;
  };

  const runTranscription = async (id: string) => {
    const m = getMeeting(id);
    const segmentIds = m ? normalizedSegmentIds(m.segmentIds, m.segments || 0) : [];
    let useNative = !!nativeSTTRef.current?.available;
    let useNativeAudioDecoder = Capacitor.getPlatform() === 'android' && !!nativeAudioDecoderRef.current?.available;
    // A user can stop a very short recording before the launch-time native
    // probe finishes. Bound one direct probe here so iOS does not falsely tell
    // them to install Whisper or strand an otherwise transcribable recording.
    if (Capacitor.isNativePlatform() && nativeSTTRef.current === null) {
      try {
        const nativeResult = await withTimeout(NativeSTT.available(), 5_000, 'native transcription availability check timed out');
        nativeSTTRef.current = nativeResult;
        setNativeSTT(nativeResult);
        useNative = nativeResult.available;
      } catch (probeError) {
        dlogError('nativestt.probe.retry.fail', probeError);
      }
    }
    if (Capacitor.getPlatform() === 'android' && nativeAudioDecoderRef.current === null) {
      try {
        const decoderResult = await withTimeout(
          NativeAudioDecoder.available(),
          5_000,
          'native Android audio decoder availability check timed out',
        );
        nativeAudioDecoderRef.current = decoderResult;
        useNativeAudioDecoder = decoderResult.available;
      } catch (probeError) {
        nativeAudioDecoderRef.current = { available: false };
        dlogError('nativeaudio.probe.retry.fail', probeError);
      }
    }
    const gate = transcriptionStartGate({
      hasAudio: !!m && segmentIds.length > 0,
      anotherTranscriptionActive: !!transcribingIdRef.current,
      nativeEngineAvailable: useNative,
      whisperReady: whisperStateRef.current.done,
    });
    if (gate === 'missing_audio') {
      // Never leave an endless spinner: surface the inconsistent state
      if (m) updateMeeting(id, { status: 'transcription_interrupted', diag: 'No audio segments were found for this meeting when transcription started.' });
      if (!transcribingIdRef.current) setProcessing(false);
      return;
    }
    if (gate === 'queue') {
      updateMeeting(id, { status: 'queued' });
      setNotice('Another transcription is running — this recording is queued (audio is safe).');
      setTimeout(() => setNotice(''), 5000);
      return;
    }
    if (gate === 'model_unavailable') {
      const engineMessage = Capacitor.getPlatform() === 'ios'
        ? 'Apple Speech is not ready. Reopen the app, then tap Retry Transcription.'
        : 'Whisper model not installed — download it in AI Models, then tap Retry.';
      updateMeeting(id, { status: 'transcription_interrupted', diag: engineMessage });
      setNotice(`Recording saved. ${engineMessage}`);
      setTimeout(() => setNotice(''), 8000);
      setProcStatus('');
      setProcessing(false);
      return;
    }
    // The missing-audio gate above is the only path where the record can be
    // absent. Keep the invariant explicit for TypeScript and future edits.
    if (!m) return;

    if (useNative) {
      try {
        // Clear any recognizer left behind by a WebView reload or a prior
        // timed-out bridge call before a new saved-audio request can begin.
        await withTimeout(
          NativeSTT.cancel(),
          5_000,
          'Native transcription cleanup did not respond within 5 seconds.',
        );
      } catch (cleanupError) {
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        updateMeeting(id, {
          status: 'transcription_interrupted',
          diag: `${cleanupMessage} Reopen the app before Retry; saved audio and completed checkpoints are unchanged.`,
        });
        setError(`${cleanupMessage} Saved audio is safe. Reopen the app before retrying so two native transcribers cannot overlap.`);
        setProcessing(false);
        return;
      }
    }

    transcribingIdRef.current = id;
    queueFlagsRef.current = { cancel: false, pause: false };
    currentMeetingRef.current = { id, date: m.date, dur: m.dur };
    setProcessing(true);
    const total = segmentIds.length;
    const parts = [...(m.tParts || [])];
    parts.length = total;
    const requestedCheckpoint = Math.min(Math.max(0, m.tNext || 0), total);
    // A checkpoint is trustworthy only when every earlier segment has a
    // persisted entry. Empty strings are valid (silent audio); sparse holes
    // are not. Rewind to the first hole instead of completing a transcript
    // with a missing middle section.
    let next = safeResumeIndex(parts, requestedCheckpoint, total);
    let currentSubSegment = m.tSubSegment;
    let currentSubNext = m.tSubNext;
    let currentSubTotal = m.tSubTotal;
    let currentSubParts = [...(m.tSubParts || [])];
    if (next !== requestedCheckpoint) {
      dlog('transcribe.checkpoint.rewind', { id, requested: requestedCheckpoint, actual: next });
    }
    // Count the ATTEMPT up front: a WebView crash mid-transcription never runs
    // the catch below, and an uncounted crash would auto-resume forever.
    const attempt = (m.retries || 0) + 1;
    updateMeeting(id, { status: 'transcribing', retries: attempt });
    dlog('transcribe.start', { id, from: next, total, attempt });

    try {
      while (next < total) {
        if (queueFlagsRef.current.cancel || queueFlagsRef.current.pause) {
          const paused = queueFlagsRef.current.pause;
          updateMeeting(id, {
            status: paused ? 'transcription_interrupted' : 'saved',
            tNext: next, tParts: parts,
            diag: paused ? 'Paused — Retry resumes from the last completed segment.' : 'Transcription canceled; the audio is kept.',
          });
          dlog('transcribe.userstop', { id, paused, at: next });
          setProcessing(false);
          return;
        }
        setProcStatus(`Transcribing ${next + 1}/${total}`);
        let text: string;
        if (useNative) {
          // Apple Speech reads app-private audio directly. Long imports are
          // sliced natively into one-minute CAF units and checkpointed after
          // every unit, so no hours-long blob crosses WKWebView and Retry never
          // discards completed Apple Speech work.
          const path = await withTimeout(
            segmentNativePath(id, segmentIds[next]),
            30_000,
            `audio segment ${next + 1} storage lookup timed out`,
          );
          if (!path) throw new Error(`audio segment ${next + 1} could not be located in storage`);
          const audioInfo = await withTimeout(
            NativeSTT.info({ path }),
            30_000,
            `audio segment ${next + 1} inspection timed out`,
          );
          const nativeSpeechChunkMs = Math.min(
            IOS_NATIVE_STT_CHUNK_MS,
            Math.max(1, nativeSTTRef.current?.maxChunkMs || IOS_NATIVE_STT_CHUNK_MS),
          );
          const nativeSpeechLabel = Capacitor.getPlatform() === 'android' ? 'Android on-device speech' : 'Apple Speech';
          const ranges = audioTimeChunkRanges(audioInfo.durationMs, nativeSpeechChunkMs);
          if (!ranges.length) throw new Error(`audio segment ${next + 1} has no decodable duration`);
          if (next === 0 && total === 1 && !m.dur) {
            updateMeeting(id, { dur: Math.round(audioInfo.durationMs / 1000) });
          }

          if (ranges.length === 1) {
            const range = ranges[0];
            const result = await withTimeout(
              NativeSTT.transcribeFile({ path, startMs: range.startMs, durationMs: range.durationMs }),
              300_000,
              'native transcription stalled (5-minute timeout)',
            );
            text = result.text;
          } else {
            const live = getMeeting(id);
            const canResumeSubCheckpoint = live?.tSubSegment === next && live.tSubTotal === ranges.length;
            currentSubSegment = next;
            currentSubTotal = ranges.length;
            currentSubParts = canResumeSubCheckpoint ? [...(live?.tSubParts || [])] : [];
            currentSubParts.length = ranges.length;
            const requestedSubCheckpoint = canResumeSubCheckpoint ? (live?.tSubNext || 0) : 0;
            currentSubNext = safeResumeIndex(currentSubParts, requestedSubCheckpoint, ranges.length);
            if (currentSubNext !== requestedSubCheckpoint) {
              dlog('transcribe.subcheckpoint.rewind', { id, segment: next, requested: requestedSubCheckpoint, actual: currentSubNext });
            }
            while (currentSubNext < ranges.length) {
              if (queueFlagsRef.current.cancel || queueFlagsRef.current.pause) {
                const paused = queueFlagsRef.current.pause;
                updateMeeting(id, {
                  status: paused ? 'transcription_interrupted' : 'saved',
                  tNext: next,
                  tParts: parts,
                  tSubSegment: currentSubSegment,
                  tSubNext: currentSubNext,
                  tSubTotal: currentSubTotal,
                  tSubParts: currentSubParts,
                  diag: paused
                    ? `Paused at ${nativeSpeechLabel} chunk ${currentSubNext + 1}/${ranges.length}; Retry resumes from the last completed chunk.`
                    : `Transcription canceled; completed ${nativeSpeechLabel} chunks and the original audio are kept.`,
                });
                dlog('transcribe.userstop.applechunk', { id, segment: next, chunk: currentSubNext, total: ranges.length });
                setProcessing(false);
                return;
              }
              setProcStatus(`Transcribing ${next + 1}/${total} · ${nativeSpeechLabel} chunk ${currentSubNext + 1}/${ranges.length}`);
              const range = ranges[currentSubNext];
              const result = await withTimeout(
                NativeSTT.transcribeFile({ path, startMs: range.startMs, durationMs: range.durationMs }),
                300_000,
                `${nativeSpeechLabel} chunk ${currentSubNext + 1}/${ranges.length} stalled for five minutes`,
              );
              currentSubParts[currentSubNext] = (result.text || '').replace(/\[BLANK_AUDIO\]/g, '').trim();
              currentSubNext++;
              updateMeeting(id, {
                tNext: next,
                tParts: parts,
                tSubSegment: currentSubSegment,
                tSubNext: currentSubNext,
                tSubTotal: currentSubTotal,
                tSubParts: currentSubParts,
              });
              dlog('transcribe.applechunk.done', {
                id,
                segment: next,
                chunk: currentSubNext - 1,
                total: ranges.length,
                startMs: range.startMs,
                durationMs: range.durationMs,
              });
            }
            text = assembleTranscriptParts(currentSubParts, ranges.length);
          }
        } else if (useNativeAudioDecoder) {
          // Android decodes directly from the app-private file in bounded
          // one-minute units. Encoded hours-long input never enters the
          // WebView and every completed unit is durably checkpointed.
          const path = await withTimeout(
            segmentNativePath(id, segmentIds[next]),
            30_000,
            `audio segment ${next + 1} storage lookup timed out`,
          );
          if (!path) throw new Error(`audio segment ${next + 1} could not be located in storage`);
          const audioInfo = await withTimeout(
            NativeAudioDecoder.info({ path }),
            30_000,
            `audio segment ${next + 1} inspection timed out`,
          );
          const nativeChunkMs = Math.min(
            ANDROID_NATIVE_DECODE_CHUNK_MS,
            Math.max(1, nativeAudioDecoderRef.current?.maxChunkMs || ANDROID_NATIVE_DECODE_CHUNK_MS),
          );
          const ranges = audioTimeChunkRanges(audioInfo.durationMs, nativeChunkMs);
          if (!ranges.length) throw new Error(`audio segment ${next + 1} has no decodable duration`);
          if (next === 0 && !m.dur) {
            updateMeeting(id, { dur: Math.round((audioInfo.durationMs / 1000) * total) });
          }

          const live = getMeeting(id);
          const canResumeSubCheckpoint = live?.tSubSegment === next && live.tSubTotal === ranges.length;
          currentSubSegment = next;
          currentSubTotal = ranges.length;
          currentSubParts = canResumeSubCheckpoint ? [...(live?.tSubParts || [])] : [];
          currentSubParts.length = ranges.length;
          const requestedSubCheckpoint = canResumeSubCheckpoint ? (live?.tSubNext || 0) : 0;
          currentSubNext = safeResumeIndex(currentSubParts, requestedSubCheckpoint, ranges.length);
          if (currentSubNext !== requestedSubCheckpoint) {
            dlog('transcribe.subcheckpoint.rewind', { id, segment: next, requested: requestedSubCheckpoint, actual: currentSubNext });
          }
          while (currentSubNext < ranges.length) {
            if (queueFlagsRef.current.cancel || queueFlagsRef.current.pause) {
              const paused = queueFlagsRef.current.pause;
              updateMeeting(id, {
                status: paused ? 'transcription_interrupted' : 'saved',
                tNext: next,
                tParts: parts,
                tSubSegment: currentSubSegment,
                tSubNext: currentSubNext,
                tSubTotal: currentSubTotal,
                tSubParts: currentSubParts,
                diag: paused
                  ? `Paused at native audio chunk ${currentSubNext + 1}/${ranges.length}; Retry resumes from the last completed chunk.`
                  : 'Transcription canceled; completed native chunks and the original audio are kept.',
              });
              dlog('transcribe.userstop.nativechunk', { id, segment: next, chunk: currentSubNext, total: ranges.length });
              setProcessing(false);
              return;
            }
            setProcStatus(`Transcribing ${next + 1}/${total} · native audio chunk ${currentSubNext + 1}/${ranges.length}`);
            const range = ranges[currentSubNext];
            const decoded = await withTimeout(
              NativeAudioDecoder.decodeChunk({ path, startMs: range.startMs, durationMs: range.durationMs }),
              150_000,
              `native audio chunk ${currentSubNext + 1}/${ranges.length} decode timed out`,
            );
            if (decoded.sampleRate !== 16_000 || decoded.channels !== 1) {
              throw new Error(`native decoder returned unsupported ${decoded.sampleRate} Hz/${decoded.channels}-channel audio`);
            }
            const audioF32 = pcm16Base64ToFloat32(decoded.pcm16Base64, decoded.samples);
            const chunkText = await transcribeFloat32(audioF32);
            currentSubParts[currentSubNext] = (chunkText || '').replace(/\[BLANK_AUDIO\]/g, '').trim();
            currentSubNext++;
            updateMeeting(id, {
              tNext: next,
              tParts: parts,
              tSubSegment: currentSubSegment,
              tSubNext: currentSubNext,
              tSubTotal: currentSubTotal,
              tSubParts: currentSubParts,
            });
            dlog('transcribe.nativechunk.done', {
              id,
              segment: next,
              chunk: currentSubNext - 1,
              total: ranges.length,
              samples: decoded.samples,
              decodedMs: decoded.durationMs,
            });
          }
          text = assembleTranscriptParts(currentSubParts, ranges.length);
        } else {
          const blob = await withTimeout(
            readSegment(id, segmentIds[next], m.mimeType || 'audio/mp4'),
            30_000,
            `audio segment ${next + 1} read timed out`,
          );
          if (!blob) throw new Error(`audio segment ${next + 1} could not be read from storage`);
          const audioF32 = await withTimeout(
            getAudioData([blob], 16000),
            300_000,
            `audio segment ${next + 1} decode/resample stalled for five minutes`,
          );
          if (next === 0 && !m.dur) {
            updateMeeting(id, { dur: Math.round((audioF32.length / 16000) * total) });
          }
          const ranges = audioChunkRanges(audioF32.length, WEB_TRANSCRIBE_CHUNK_SAMPLES);
          if (ranges.length <= 1) {
            text = await transcribeFloat32(audioF32);
          } else {
            // Imported files may contain hours in one saved blob. Keep every
            // inference request bounded and checkpoint each five-minute unit,
            // so a worker failure cannot discard already-completed text or
            // silently skip a missing middle unit on Retry.
            const live = getMeeting(id);
            const canResumeSubCheckpoint = live?.tSubSegment === next && live.tSubTotal === ranges.length;
            currentSubSegment = next;
            currentSubTotal = ranges.length;
            currentSubParts = canResumeSubCheckpoint ? [...(live?.tSubParts || [])] : [];
            currentSubParts.length = ranges.length;
            const requestedSubCheckpoint = canResumeSubCheckpoint ? (live?.tSubNext || 0) : 0;
            currentSubNext = safeResumeIndex(currentSubParts, requestedSubCheckpoint, ranges.length);
            if (currentSubNext !== requestedSubCheckpoint) {
              dlog('transcribe.subcheckpoint.rewind', { id, segment: next, requested: requestedSubCheckpoint, actual: currentSubNext });
            }
            while (currentSubNext < ranges.length) {
              if (queueFlagsRef.current.cancel || queueFlagsRef.current.pause) {
                const paused = queueFlagsRef.current.pause;
                updateMeeting(id, {
                  status: paused ? 'transcription_interrupted' : 'saved',
                  tNext: next,
                  tParts: parts,
                  tSubSegment: currentSubSegment,
                  tSubNext: currentSubNext,
                  tSubTotal: currentSubTotal,
                  tSubParts: currentSubParts,
                  diag: paused
                    ? `Paused at bounded audio chunk ${currentSubNext + 1}/${ranges.length}; Retry resumes from the last completed chunk.`
                    : 'Transcription canceled; completed chunks and the original audio are kept.',
                });
                dlog('transcribe.userstop.subchunk', { id, paused, segment: next, chunk: currentSubNext, total: ranges.length });
                setProcessing(false);
                return;
              }
              setProcStatus(`Transcribing ${next + 1}/${total} · audio chunk ${currentSubNext + 1}/${ranges.length}`);
              const range = ranges[currentSubNext];
              const chunkText = await transcribeFloat32(audioF32.slice(range.start, range.end));
              currentSubParts[currentSubNext] = (chunkText || '').replace(/\[BLANK_AUDIO\]/g, '').trim();
              currentSubNext++;
              updateMeeting(id, {
                tNext: next,
                tParts: parts,
                tSubSegment: currentSubSegment,
                tSubNext: currentSubNext,
                tSubTotal: currentSubTotal,
                tSubParts: currentSubParts,
              });
              dlog('transcribe.subchunk.done', { id, segment: next, chunk: currentSubNext - 1, total: ranges.length });
            }
            text = assembleTranscriptParts(currentSubParts, ranges.length);
          }
        }
        parts[next] = (text || '').replace(/\[BLANK_AUDIO\]/g, '').trim();
        next++;
        currentSubSegment = undefined;
        currentSubNext = undefined;
        currentSubTotal = undefined;
        currentSubParts = [];
        // Checkpoint after EVERY segment — resume never repeats finished work
        updateMeeting(id, {
          tNext: next,
          tParts: parts,
          tSubSegment: undefined,
          tSubNext: undefined,
          tSubTotal: undefined,
          tSubParts: undefined,
        });
        dlog('transcribe.segment.done', { id, seg: next - 1, chars: parts[next - 1].length });
      }

      const full = assembleTranscriptParts(parts, total);
      let transcriptStored = false;
      let transcriptMetadata = transcriptIntegrity(full);
      if (full) {
        try {
          transcriptMetadata = await saveMeetingTranscript(id, full);
          transcriptStored = true;
        } catch (e) {
          // Loss-safe fallback: retain the full text in localStorage if the
          // larger IndexedDB content store is unavailable or out of quota.
          dlogError('meeting.content.save.fail', e, { id, chars: full.length });
        }
      }
      updateMeeting(id, {
        transcript: full, transcriptStored, ...transcriptMetadata, status: 'complete', tParts: undefined, tNext: undefined,
        tSubSegment: undefined, tSubNext: undefined, tSubTotal: undefined, tSubParts: undefined, retries: undefined,
        diag: full ? undefined : 'No speech detected in the audio — the recording is kept.',
      });
      setTranscript(full); transcriptRef.current = full;
      dlog('transcribe.complete', { id, chars: full.length });
      if (full) {
        if (embedderStateRef.current.done) {
          const automaticIndex = new AbortController();
          const automaticIndexTimer = window.setTimeout(() => automaticIndex.abort(new Error(
            'Automatic semantic indexing reached its 15-minute safety limit. The transcript is complete and full-text searchable; use Index Remaining Meetings later.',
          )), SEMANTIC_INDEX_JOB_MAX_MS);
          void indexMeeting(
            { id, transcript: full, ...transcriptMetadata } as MeetingRecord,
            { signal: automaticIndex.signal },
          ).catch(indexError => {
            dlogError('search.index.auto.fail', indexError, { id });
            setNotice(`${indexError instanceof Error ? indexError.message : String(indexError)} Full-text search remains available.`);
            setTimeout(() => setNotice(''), 9000);
          }).finally(() => clearTimeout(automaticIndexTimer));
        }
        setProcStatus('Summarizing…');
        runSummarization(full); // llm/title flow clears `processing` when done
      } else {
        setProcessing(false);
      }
    } catch (e: unknown) {
      // A JavaScript watchdog cannot implicitly stop native work. Explicitly
      // cancel the platform recognizer so a timed-out task never continues
      // invisibly or overlaps the user's Retry request.
      let nativeCleanupConfirmed = true;
      if (useNative) {
        try {
          await withTimeout(
            NativeSTT.cancel(),
            5_000,
            'Native transcription cancellation did not respond within 5 seconds.',
          );
        } catch (cancelError) {
          nativeCleanupConfirmed = false;
          dlogError('nativestt.cancel.fail', cancelError, { id });
        }
      }
      const originalMessage = e instanceof Error ? e.message : String(e);
      const msg = nativeCleanupConfirmed
        ? originalMessage
        : `${originalMessage} Native cleanup could not be confirmed; reopen the app before Retry.`;
      if (Capacitor.getPlatform() === 'android' && useNative && isPermanentNativeEngineFailure(msg)) {
        const fallbackState: NativeSTTAvailability = {
          available: false,
          engine: nativeSTTRef.current?.engine,
          reason: `${msg} Whisper remains available as a retry fallback.`,
        };
        nativeSTTRef.current = fallbackState;
        setNativeSTT(fallbackState);
        if (whisperStateRef.current.done) modelInitStartRef.current?.('whisper');
        dlog('nativestt.android.fallback', { id, reason: msg, whisperInstalled: whisperStateRef.current.done });
      }
      if (queueFlagsRef.current.pause || queueFlagsRef.current.cancel) {
        const paused = queueFlagsRef.current.pause;
        updateMeeting(id, {
          status: paused ? 'transcription_interrupted' : 'saved',
          tNext: next,
          tParts: parts,
          ...(currentSubSegment === next ? {
            tSubSegment: currentSubSegment,
            tSubNext: currentSubNext,
            tSubTotal: currentSubTotal,
            tSubParts: currentSubParts,
          } : {}),
          retries: undefined,
          diag: paused
            ? 'Paused safely — Retry resumes from the last completed audio checkpoint.'
            : 'Transcription canceled; completed checkpoints and the original audio are kept.',
        });
        dlog('transcribe.userstop.inflight', { id, paused, at: next, sub: currentSubNext });
        setProcessing(false);
        return;
      }
      const attemptNow = getMeeting(id)?.retries || 1;
      const failurePatch: Partial<MeetingRecord> = {
        status: attemptNow >= 3 ? 'transcription_failed' : 'transcription_interrupted',
        tNext: next, tParts: parts, diag: msg,
        ...(currentSubSegment === next ? {
          tSubSegment: currentSubSegment,
          tSubNext: currentSubNext,
          tSubTotal: currentSubTotal,
          tSubParts: currentSubParts,
        } : {}),
      };
      let recoveryStateSaved = true;
      try {
        updateMeeting(id, failurePatch);
      } catch (stateError) {
        // Storage pressure may be the original failure. Keep the current UI
        // resumable even when the failure patch itself cannot reach localStorage;
        // on relaunch, the last durable `transcribing` state also normalizes to
        // interrupted rather than spinning forever.
        recoveryStateSaved = false;
        const emergency = meetingsRef.current.map(meeting => meeting.id === id ? { ...meeting, ...failurePatch } : meeting);
        meetingsRef.current = emergency;
        setMeetings(emergency);
        dlogError('transcribe.recovery_state.save.fail', stateError, { id, at: next });
      }
      dlogError('transcribe.fail', e, { id, at: next, attempt: attemptNow });
      setError(`Transcription stopped at segment ${next + 1}/${total}: ${msg}. Your audio is safe — ${recoveryStateSaved ? 'Retry resumes from this point.' : 'free storage, reopen the app, and Retry from the last durable checkpoint.'}`);
      setProcessing(false);
    } finally {
      transcribingIdRef.current = null;
      // A queued meeting (recorded while we were busy) starts automatically
      // even when the user canceled only the current meeting. Otherwise a
      // different saved recording could remain queued forever.
      const queued = meetingsRef.current.find(x => x.status === 'queued');
      if (queued) void runTranscription(queued.id);
    }
  };

  const retryTranscription = async (m: MeetingRecord) => {
    if (transcribingIdRef.current === m.id) return;
    // Reconcile a stale/corrupt segment count from the exact manifest or disk
    // before assuming this is a legacy single-blob recording.
    let candidate = m;
    let knownIds = normalizedSegmentIds(m.segmentIds, m.segments || 0);
    if (!knownIds.length) {
      try {
        knownIds = await withTimeout(
          listSegmentsOnDisk(m.id),
          30_000,
          'Retry timed out while locating saved audio. The recording is still safe; reopen the app and try again.',
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    if (knownIds.length) {
      candidate = { ...m, audioKind: 'segments', segments: knownIds.length, segmentIds: knownIds };
      updateMeeting(m.id, candidate);
    } else if (m.audioKind === 'single' || !m.segments) {
      // Legacy v9 meetings stored one blob under the plain id — migrate to seg-0
      const legacy = await idb.get<Blob>('audio', m.id).catch(() => null);
      if (!legacy) { setError('No stored audio found for this meeting.'); return; }
      try {
        await writeSegment(m.id, 0, legacy);
        candidate = { ...m, audioKind: 'segments', segments: 1, segmentIds: [0], bytes: legacy.size, mimeType: legacy.type || 'audio/mp4' };
        updateMeeting(m.id, candidate);
      } catch (e: unknown) {
        setError(`Could not prepare audio for retry: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    updateMeeting(candidate.id, { status: 'queued', diag: undefined });
    await runTranscription(candidate.id);
  };

  const cancelActiveNativeSpeech = () => {
    if (Capacitor.isNativePlatform() && nativeSTTRef.current?.available) {
      void withTimeout(
        NativeSTT.cancel(),
        5_000,
        'Native transcription cancellation did not respond within 5 seconds.',
      ).catch(error => {
        dlogError('nativestt.usercancel.fail', error);
        setError('The native transcriber did not confirm cancellation. Saved audio is safe; reopen the app before Retry.');
      });
    }
  };
  const pauseTranscription = () => {
    queueFlagsRef.current.pause = true;
    setProcStatus('Pausing safely at the current audio checkpoint…');
    cancelActiveNativeSpeech();
  };
  const cancelTranscription = () => {
    queueFlagsRef.current.cancel = true;
    setProcStatus('Stopping — audio and completed checkpoints will be kept…');
    cancelActiveNativeSpeech();
  };

  const refreshStorageInfo = async () => {
    const free = await freeBytes();
    if (free === null) { setStorageInfo(null); return; }
    const r = recorderRef.current;
    // bytes/min from this session once we have a sample, else ~0.25 MB/min AAC mono
    const rate = r && r.recordedMs > 5000 ? r.totalBytes / (r.recordedMs / 60000) : 250_000;
    setStorageInfo({
      freeMB: Math.round(free / 1048576),
      estMin: rate > 0 ? Math.round(Math.max(0, free - STORAGE_WARN_BYTES / 5) / rate) : null,
    });
  };

  /* ─── On-device reliability self-test (Settings → Diagnostics) ───
     Drives the REAL record→save→transcribe pipeline N times with a synthesized
     stream. Persists a cursor after every step: a force-quit mid-run resumes
     on relaunch and is counted as a recovery event. */
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const waitWhileSelfTestActive = async (ms: number, runId: string): Promise<boolean> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const live = loadSelfTest();
      if (!live?.running || live.startedAt !== runId) return false;
      await sleep(Math.min(1000, Math.max(0, deadline - Date.now())));
    }
    return true;
  };

  const awaitTerminal = async (id: string, maxSec: number, runId?: string): Promise<MeetingRecord | undefined> => {
    for (let t = 0; t < maxSec; t++) {
      const m = getMeeting(id);
      if (m && ['complete', 'transcription_failed', 'transcription_interrupted', 'recovery_required'].includes(m.status || '')) return m;
      if (runId) {
        const live = loadSelfTest();
        if (!live?.running || live.startedAt !== runId) return getMeeting(id); // run canceled/replaced
      }
      await sleep(1000);
    }
    return getMeeting(id);
  };

  const runSelfTest = async (initial: SelfTestState) => {
    if (selfTestBusyRef.current) return;
    selfTestBusyRef.current = true;
    let st = { ...initial };
    const persist = async () => { saveSelfTest(st); setSelfTest({ ...st }); await writeResultsFile(st); };
    dlog('selftest.run', { fromCycle: st.cycle, total: st.total, kills: st.kills });

    try {
      // Model gate: trigger download and wait (network-dependent, up to 10 min)
      if (!nativeSTTRef.current?.available && !whisperStateRef.current.done) {
        dl('whisper');
        for (let t = 0; t < 600 && !whisperStateRef.current.done; t++) {
          if (!whisperStateRef.current.loading && whisperStateRef.current.error) break;
          if (!await waitWhileSelfTestActive(1000, st.startedAt)) { st.running = false; break; }
        }
        if (st.running && !whisperStateRef.current.done) {
          st.running = false;
          await persist();
          setError(`Reliability self-test stopped before recording: ${whisperStateRef.current.error || 'Whisper did not become ready within ten minutes.'}`);
          return;
        }
      }

      // A cycle interrupted by a kill: finish it via the real recovery path
      if (st.activeMeetingId && !st.results.some(r => r.cycle === st.cycle)) {
        const m = getMeeting(st.activeMeetingId);
        if (m) {
          const t0 = performance.now();
          if (m.status !== 'complete' && (m.segments || 0) > 0) await retryTranscription(m);
          const done = await awaitTerminal(st.activeMeetingId, 300, st.startedAt);
          st.results.push({
            cycle: st.cycle, resumedAfterKill: true,
            saved: (done?.segments || 0) > 0 && (done?.bytes || 0) > 0,
            transcribed: done?.status === 'complete',
            status: done?.status || 'missing', segments: done?.segments, bytes: done?.bytes, dur: done?.dur,
            ms: Math.round(performance.now() - t0),
          });
          await remove(st.activeMeetingId);
          const live = loadSelfTest();
          if (!live?.running || live.startedAt !== st.startedAt) { st.running = false; return; }
          st = { ...st, cycle: st.cycle + 1, activeMeetingId: undefined };
          await persist();
        } else {
          // Meeting shell vanished — record the failure honestly
          st.results.push({ cycle: st.cycle, saved: false, transcribed: false, status: 'missing', ms: 0, resumedAfterKill: true });
          const live = loadSelfTest();
          if (!live?.running || live.startedAt !== st.startedAt) { st.running = false; return; }
          st = { ...st, cycle: st.cycle + 1, activeMeetingId: undefined };
          await persist();
        }
      }

      while (st.running && st.cycle <= st.total) {
        const t0 = performance.now();
        const { stream, dispose } = makeTestStream();
        try {
          // Keep diagnostics deterministic and microphone-free even though
          // production mobile capture now runs natively.
          await start(stream);
          const id = currentMeetingRef.current?.id;
          st = { ...st, activeMeetingId: id };
          await persist();
          await waitWhileSelfTestActive((st.ladder?.[st.cycle - 1] ?? st.recordSecs) * 1000, st.startedAt);
          await stop();
        } finally { /* synthetic stream is disposed after terminal state */ }
        const id = st.activeMeetingId;
        const m = id ? await awaitTerminal(id, 300, st.startedAt) : undefined;
        dispose();
        st.results.push({
          cycle: st.cycle,
          saved: (m?.segments || 0) > 0 && (m?.bytes || 0) > 0,
          transcribed: m?.status === 'complete',
          status: m?.status || 'missing', segments: m?.segments, bytes: m?.bytes, dur: m?.dur,
          ms: Math.round(performance.now() - t0),
        });
        dlog('selftest.cycle', { ...st.results[st.results.length - 1] });
        if (id) await remove(id); // keep the device clean across 25 runs
        // Check cancellation/replacement BEFORE persisting. Otherwise the
        // stale local state can overwrite a Stop request or newer run.
        const live = loadSelfTest();
        if (!live?.running || live.startedAt !== st.startedAt) { st.running = false; break; }
        st = { ...st, cycle: st.cycle + 1, activeMeetingId: undefined };
        await persist();
      }

      if (st.cycle > st.total) {
        st = { ...st, running: false, finishedAt: new Date().toISOString() };
        await persist();
        dlog('selftest.finished', summarize(st) as unknown as Record<string, unknown>);
      }
    } catch (e) {
      dlogError('selftest.crash', e, { cycle: st.cycle });
      st = { ...st, running: false };
      await persist();
    } finally {
      selfTestBusyRef.current = false;
    }
  };

  const startSelfTest = () => {
    const st = newSelfTest(25, 20);
    saveSelfTest(st);
    setSelfTest(st);
    void runSelfTest(st);
  };

  const stopSelfTest = () => {
    const st = loadSelfTest();
    if (st) { st.running = false; saveSelfTest(st); setSelfTest({ ...st }); }
  };

  const runIntegrityCheck = async () => {
    if (integrityBusy || recording || processing) return;
    setIntegrityBusy(true);
    setError('');
    try {
      const result = await withTimeout(
        runIntelligenceIntegrityCheck(),
        15 * 60_000,
        'The integrity check reached its 15-minute safety limit. Synthetic test data will be cleaned up on the next run; your saved meetings were not changed.',
      );
      setIntegrityResult(result);
      if (!result.passed) setError('Meeting intelligence integrity check failed. The failed step is shown in Diagnostics; saved user meetings were not changed.');
    } catch (integrityError) {
      setError(`Meeting intelligence integrity check could not finish: ${integrityError instanceof Error ? integrityError.message : String(integrityError)}`);
    } finally {
      setIntegrityBusy(false);
    }
  };

  /* ─── Semantic indexing ─── */
  const embedTexts = (texts: string[], signal?: AbortSignal): Promise<number[][]> => {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error('Semantic indexing was canceled.'));
        return;
      }
      if (!embedWorkerRef.current || !embedderStateRef.current.done) {
        reject(new Error('Embedder not installed'));
        return;
      }
      const requestId = ++embedRequestSeqRef.current;
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        embedRequestsRef.current.delete(requestId);
        reject(error);
      };
      const onAbort = () => finishReject(signal?.reason instanceof Error
        ? signal.reason
        : new Error('Semantic indexing was canceled. Completed meeting indexes were kept.'));
      const timer = window.setTimeout(() => {
        finishReject(new Error('Search indexing timed out. Completed meeting indexes were kept; retry from AI Models.'));
      }, 120_000);
      signal?.addEventListener('abort', onAbort, { once: true });
      embedRequestsRef.current.set(requestId, {
        resolve: value => {
          if (settled) return;
          settled = true;
          cleanup();
          try {
            assertEmbeddingBatch(value, texts.length);
            resolve(value);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        reject: finishReject,
      });
      embedWorkerRef.current.postMessage({ type: 'embed', texts, requestId });
    });
  };

  const indexMeeting = async (
    r: MeetingRecord,
    options: { signal?: AbortSignal; onProgress?: (completed: number, total: number) => void } = {},
  ) => {
    if (!r.transcript?.trim()) return;
    const chunks = chunkTranscript(r.transcript);
    const vectors: number[][] = [];
    let dimension: number | undefined;
    // Bound worker messages and model memory for multi-hour transcripts.
    for (let i = 0; i < chunks.length; i += 16) {
      if (options.signal?.aborted) throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new Error('Semantic indexing was canceled. Completed meeting indexes were kept.');
      const requested = chunks.slice(i, i + 16);
      const batch = await embedTexts(requested, options.signal);
      dimension = assertEmbeddingBatch(batch, requested.length, dimension);
      vectors.push(...batch);
      options.onProgress?.(Math.min(i + requested.length, chunks.length), chunks.length);
    }
    if (options.signal?.aborted) throw options.signal.reason instanceof Error
      ? options.signal.reason
      : new Error('Semantic indexing was canceled. Completed meeting indexes were kept.');
    await saveMeetingVectors(r, chunks.map((text, chunkIndex) => ({ text, chunkIndex, vector: vectors[chunkIndex] })));
    const ids = await indexedMeetingIds(meetingsRef.current);
    setIndexedCount(ids.size);
  };

  const indexAll = async () => {
    if (indexAbortRef.current) return;
    const controller = new AbortController();
    indexAbortRef.current = controller;
    const hardTimer = window.setTimeout(() => controller.abort(new Error(
      'Semantic indexing reached its 15-minute safety limit. Completed meeting indexes were kept; tap Index Remaining Meetings to resume.',
    )), SEMANTIC_INDEX_JOB_MAX_MS);
    setIndexing(true);
    setIndexProgress('Checking saved transcripts…');
    setError('');
    try {
      const libraryMeetings = meetingsRef.current;
      const done = await indexedMeetingIds(libraryMeetings);
      const targets = libraryMeetings.filter(meeting =>
        (meeting.transcriptOutcome === 'text' || !!meeting.transcript?.trim()) && !done.has(meeting.id));
      for (let meetingIndex = 0; meetingIndex < targets.length; meetingIndex++) {
        const compactMeeting = targets[meetingIndex];
        let meeting: MeetingRecord | null = null;
        setIndexProgress(`Indexing meeting ${meetingIndex + 1}/${targets.length}: preparing transcript…`);
        await scanVerifiedMeetingTranscripts([compactMeeting], verified => { meeting = verified; }, { signal: controller.signal });
        if (!meeting) throw new Error('A transcribed meeting could not be loaded for semantic indexing. Its saved audio and lexical search remain available.');
        await indexMeeting(meeting, {
          signal: controller.signal,
          onProgress: (completed, total) => setIndexProgress(
            `Indexing meeting ${meetingIndex + 1}/${targets.length}: ${completed}/${total} transcript sections`,
          ),
        });
      }
      const current = await indexedMeetingIds(meetingsRef.current);
      setIndexedCount(current.size);
      setNotice(targets.length
        ? `Semantic indexing complete — ${current.size}/${indexableMeetingCount(meetingsRef.current)} transcribed meetings are current.`
        : 'Every transcribed meeting already has a current semantic index.');
      setTimeout(() => setNotice(''), 6000);
    } catch (e: any) {
      const current = await indexedMeetingIds(meetingsRef.current).catch(() => new Set<string>());
      setIndexedCount(current.size);
      setError(`Indexing stopped: ${e.message} Full-text search remains available.`);
    } finally {
      clearTimeout(hardTimer);
      if (indexAbortRef.current === controller) indexAbortRef.current = null;
      setIndexing(false);
      setIndexProgress('');
    }
  };

  const cancelIndexAll = () => {
    indexAbortRef.current?.abort(new Error(
      'Semantic indexing was canceled. Completed meeting indexes were kept; tap Index Remaining Meetings to resume.',
    ));
  };

  /* ─── Ask your meetings ─── */
  const ask = async () => {
    const q = askQuery.trim();
    if (!q || askBusy) return;
    setAskBusy(true); setAskProgress('Preparing complete-library search…'); setAskAnswer(''); setAskSources([]); setError('');
    try {
      const libraryMeetings = meetingsRef.current;
      const rawSemanticHits: Chunk[] = [];
      let semanticFailure: Error | null = null;
      if (embedderStateRef.current.done) {
        try {
          const [qv] = await embedTexts([q]);
          const currentIndexes = await indexedMeetingIds(libraryMeetings);
          setIndexedCount(currentIndexes.size);
          const textMeetings = indexableMeetingCount(libraryMeetings);
          if (currentIndexes.size < textMeetings) {
            setNotice('Some semantic indexes are missing or out of date. Complete saved transcripts were searched directly; use Index All Meetings to rebuild meaning-based search.');
            setTimeout(() => setNotice(''), 6000);
          }
          rawSemanticHits.push(...await searchVectors(qv, libraryMeetings, 25));
        } catch (error) {
          semanticFailure = error instanceof Error ? error : new Error(String(error));
          dlogError('search.semantic.fail', semanticFailure);
        }
      }
      // Verify archives one at a time and retain only bounded excerpts. This
      // searches the complete library without hydrating every hours-long body
      // into React memory. The same pass validates semantic excerpts against
      // chunks derived from the exact current transcript.
      const lexicalHits: ReturnType<typeof searchMeetingText> = [];
      const semanticMeetingIds = new Set(rawSemanticHits.map(hit => hit.meetingId));
      const verifiedSemanticText = new Map<string, Set<string>>();
      await scanVerifiedMeetingTranscripts(libraryMeetings, meeting => {
        lexicalHits.push(...searchMeetingText([meeting], q, 5));
        lexicalHits.sort((left, right) => right.score - left.score);
        if (lexicalHits.length > 5) lexicalHits.splice(5);
        if (semanticMeetingIds.has(meeting.id)) {
          verifiedSemanticText.set(meeting.id, new Set(chunkTranscript(meeting.transcript)));
        }
      }, {
        maxDurationMs: LIBRARY_SCAN_MAX_MS,
        onProgress: (completed, total) => setAskProgress(`Searching saved meeting ${completed}/${total}…`),
      });
      const byId = new Map(libraryMeetings.map(meeting => [meeting.id, meeting]));
      const semanticCandidates = rawSemanticHits.flatMap(hit => {
        const meeting = byId.get(hit.meetingId);
        return meeting && verifiedSemanticText.get(hit.meetingId)?.has(hit.text)
          ? [{ title: meeting.title || 'Untitled Meeting', date: meeting.date, text: hit.text }]
          : [];
      }).slice(0, 5);
      const lexicalCandidates = lexicalHits.map(({ title, date, text }) => ({ title, date, text }));
      const excerpts = mergeSearchSources(lexicalCandidates, semanticCandidates, 5);
      if (semanticFailure) {
        setNotice('Semantic search was unavailable, so complete saved transcripts were searched directly instead.');
        setTimeout(() => setNotice(''), 5000);
      }
      if (excerpts.length === 0) {
        setAskAnswer('No matching conversation was found. Try a name, topic, decision, or action mentioned in a transcript.');
        return;
      }
      setAskSources(excerpts);

      const s = settingsRef.current;
      try {
        if (s.useCloud && s.claudeKey) {
          setAskAnswer(await withTimeout(
            askWithClaude(s.claudeKey, q, excerpts),
            120_000,
            'Cloud answer timed out after two minutes.',
          ));
        } else if (llmWorkerRef.current && gemmaStateRef.current.done) {
          const request = chatRequestsRef.current.create(120_000, 'The AI answer timed out. Matching excerpts are still available.');
          llmWorkerRef.current.postMessage({
            type: 'chat', requestId: request.requestId,
            text: chatUserPrompt(q, excerpts), systemPrompt: chatSystemPrompt(),
          });
          setAskAnswer(await request.promise);
        } else {
          setAskAnswer('Here are the strongest matching moments. Install the optional AI models for semantic matching and a generated answer.');
        }
      } catch (answerError) {
        setAskAnswer('The generated answer was unavailable, but the complete matching transcript excerpts are shown below.');
        setError(`AI answer unavailable: ${answerError instanceof Error ? answerError.message : String(answerError)}`);
      }
    } catch (e: any) {
      setAskAnswer('');
      setError(`Ask failed: ${e.message}`);
    } finally {
      setAskBusy(false);
      setAskProgress('');
    }
  };

  /* Route summarization: BYO-key Claude when enabled, else the local LLM worker */
  const runSummarization = (text: string) => {
    const s = settingsRef.current;
    const m = currentMeetingRef.current;
    if (s.useCloud && s.claudeKey) {
      // Commit a complete offline result before starting optional network work.
      // A timeout, app suspension, bad key, or oversized meeting can therefore
      // never leave the saved recording without a summary.
      const basic = createBasicSummary(text);
      setSummary(basic.summary);
      summaryRef.current = basic.summary;
      if (m) updateMeeting(m.id, { title: basic.title, summary: basic.summary, actionItems: basic.actionItems });
      setProcessing(false);
      withTimeout(
        summarizeWithClaude(
          s.claudeKey,
          summaryEnhancementInput(text, basic.summary),
          s.template as TemplateKey,
        ),
        120_000,
        'Cloud summary timed out after two minutes.',
      )
        .then(r => {
          setSummary(r.summary);
          summaryRef.current = r.summary;
          if (m) updateMeeting(m.id, { title: r.title, summary: r.summary, actionItems: r.actionItems });
        })
        .catch(err => {
          // The complete deterministic summary is already durable. A local
          // model may still refine it, but failure never reopens processing.
          setNotice(`Claude enhancement failed (${err?.message || 'error'}) — the complete private summary was kept.`);
          setTimeout(() => setNotice(''), 5000);
          runLocalSummarization(text);
        });
    } else {
      runLocalSummarization(text);
    }
  };

  const runLocalSummarization = (text: string) => {
    // Persist a useful result immediately. Optional AI replaces it when ready,
    // but can never leave an hours-long meeting without a summary.
    const basic = createBasicSummary(text);
    const m = currentMeetingRef.current;
    setSummary(basic.summary);
    summaryRef.current = basic.summary;
    if (m) updateMeeting(m.id, { title: basic.title, summary: basic.summary, actionItems: basic.actionItems });
    setProcessing(false);
    if (llmWorkerRef.current && gemmaStateRef.current.done) {
      // Gemma receives a bounded evidence packet sampled across the complete
      // meeting instead of only the opening or an oversized raw transcript.
      const modelInput = summaryEnhancementInput(text, basic.summary);
      // Supersede any older refinement for this meeting. Late replies remain
      // correlated to their original meeting and are ignored after removal.
      for (const [requestId, context] of summaryRequestsRef.current) {
        if (context.meetingId === m?.id) {
          clearTimeout(context.timer);
          summaryRequestsRef.current.delete(requestId);
        }
      }
      const requestId = ++summaryRequestSeqRef.current;
      if (m) {
        const meetingId = m.id;
        const timer = window.setTimeout(() => {
          const context = summaryRequestsRef.current.get(requestId);
          if (!context) return;
          summaryRequestsRef.current.delete(requestId);
          dlog('worker.llm.timeout', { requestId, meetingId });
          if (currentMeetingRef.current?.id === meetingId) {
            setNotice('Optional AI enhancement timed out — the complete private summary was kept.');
            setTimeout(() => setNotice(''), 6000);
          }
        }, 120_000);
        summaryRequestsRef.current.set(requestId, { meetingId, timer, fallback: basic.summary, evidence: modelInput });
      }
      llmWorkerRef.current.postMessage({
        type: 'summarize', requestId, text: modelInput,
        systemPrompt: localSummaryPrompt(settingsRef.current.template as TemplateKey),
      });
    }
  };

  /* All meeting-list writers persist synchronously from localStorage (the
     source of truth) — persisting inside batched updaters let a stale `prev`
     overwrite records that save()/updateMeeting() had just written. */
  const toggleActionItem = (meetingId: string, index: number) => {
    const u = meetingsRef.current.map(m => {
      if (m.id !== meetingId || !m.actionItems) return m;
      const items = m.actionItems.map((it, i) => i === index ? { ...it, done: !it.done } : it);
      return { ...m, actionItems: items };
    });
    persistMeetingList(u);
  };

  const createSavedSummary = (meeting: MeetingRecord) => {
    if (!meeting.transcript?.trim()) return;
    const basic = createBasicSummary(meeting.transcript);
    updateMeeting(meeting.id, { title: basic.title, summary: basic.summary, actionItems: basic.actionItems });
    setNotice('A private on-device summary was created.');
    setTimeout(() => setNotice(''), 3000);
  };

  const remove = async (id: string, requireConfirmation = false) => {
    const meeting = meetingsRef.current.find(m => m.id === id);
    if (requireConfirmation && !window.confirm(`Delete “${meeting?.title || 'this meeting'}”?\n\nThis permanently removes its recording, transcript, summary, and search index.`)) return;
    if (currentMeetingRef.current?.id === id && recording) {
      setError('Stop the active recording before deleting it so every completed audio segment can be finalized safely.');
      return;
    }
    if (transcribingIdRef.current === id) {
      setError('Pause or cancel this transcription before deleting the meeting. Saved audio and completed checkpoints remain intact.');
      return;
    }
    if (deletingIds.has(id)) return;
    setDeletingIds(current => new Set(current).add(id));
    setError('');
    try {
      await deleteMeetingArtifacts({
        deleteAudio: () => deleteMeetingAudio(id),
        deleteTranscript: () => deleteMeetingContent(id),
        deleteSearchIndex: () => deleteMeetingVectors(id),
      });
      persistMeetingList(meetingsRef.current.filter(m => m.id !== id));
      setAudioIds(previous => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
      const ids = await indexedMeetingIds(meetingsRef.current).catch(() => new Set<string>());
      setIndexedCount(ids.size);
      if (requireConfirmation) {
        setNotice('Meeting deleted from this device.');
        setTimeout(() => setNotice(''), 4000);
      }
    } catch (deletionError) {
      const message = deletionError instanceof Error ? deletionError.message : String(deletionError);
      setError(`Deletion did not finish: ${message} The meeting remains visible so you can retry; no failure was hidden.`);
      dlogError('meeting.delete.fail', deletionError, { id });
    } finally {
      setDeletingIds(current => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  /* ─── Folders ─── */
  const createFolder = () => {
    const name = window.prompt('Folder name:')?.trim();
    if (!name) return;
    setFolders(prev => {
      const u = [...prev, { id: Date.now().toString(), name }];
      store.saveFolders(u);
      return u;
    });
  };

  const deleteFolder = (id: string) => {
    const folder = folders.find(item => item.id === id);
    if (!window.confirm(`Remove the folder “${folder?.name || 'this folder'}”?\n\nMeetings will stay saved and move to All Meetings.`)) return;
    setFolders(prev => {
      const u = prev.filter(f => f.id !== id);
      store.saveFolders(u);
      return u;
    });
    const u = meetingsRef.current.map(m => m.folderId === id ? { ...m, folderId: undefined } : m);
    persistMeetingList(u);
    if (activeFolder === id) setActiveFolder('all');
  };

  const moveToFolder = (meetingId: string, folderId: string) => {
    const u = meetingsRef.current.map(m => m.id === meetingId ? { ...m, folderId: folderId || undefined } : m);
    persistMeetingList(u);
  };

  /* ─── Backup ─── */
  const downloadBackup = async () => {
    if (backupAbortRef.current) return;
    const controller = new AbortController();
    backupAbortRef.current = controller;
    setBackupBusy('export');
    setBackupProgress('Preparing complete backup…');
    setError('');
    try {
      const hydrated = await hydrateMeetingTranscripts(meetingsRef.current, {
        signal: controller.signal,
        maxDurationMs: BACKUP_JOB_MAX_MS,
        onProgress: (completed, total) => setBackupProgress(`Verifying transcript ${completed}/${total} for backup…`),
      });
      const missing = hydrated.find(hasUnavailableCompletedTranscript);
      if (missing) throw new Error(`Backup stopped because the transcript for “${missing.title || 'a meeting'}” could not be loaded. No data was changed.`);
      if (controller.signal.aborted) throw controller.signal.reason;
      setBackupProgress('Building complete backup file…');
      const prepared = hydrated.map(ensureMeetingSummary);
      const repaired = new Map(prepared.filter((meeting, index) => meeting !== hydrated[index]).map(meeting => [meeting.id, meeting]));
      if (repaired.size) {
        persistMeetingList(meetingsRef.current.map(current => {
          const complete = repaired.get(current.id);
          return complete ? {
            ...current,
            title: complete.title,
            summary: complete.summary,
            actionItems: complete.actionItems,
          } : current;
        }));
      }
      downloadBlob(
        new Blob([exportBackup(prepared)], { type: 'application/json' }),
        `MeetingGhost-Backup-${new Date().toISOString().slice(0, 10)}.json`,
      );
      setNotice(`Complete backup prepared — ${prepared.length} meeting${prepared.length === 1 ? '' : 's'}.`);
      setTimeout(() => setNotice(''), 5000);
    } catch (e) {
      setError(`Backup stopped safely: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (backupAbortRef.current === controller) backupAbortRef.current = null;
      setBackupBusy(null);
      setBackupProgress('');
    }
  };

  const handleBackupImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (backupAbortRef.current) {
      setError('Another backup operation is already running. Wait for it to finish or cancel it first.');
      return;
    }
    const controller = new AbortController();
    backupAbortRef.current = controller;
    setBackupBusy('import');
    setBackupProgress('Reading backup file…');
    setError('');
    try {
      // Hydrate first so a verified current archive remains authoritative. If
      // the archive is genuinely missing, mergeBackup can safely fill it from
      // the duplicate-ID backup body and force a new verified archive write.
      const current = await hydrateMeetingTranscripts(meetingsRef.current, {
        tolerateArchiveFailure: true,
        signal: controller.signal,
        maxDurationMs: BACKUP_JOB_MAX_MS,
        onProgress: (completed, total) => setBackupProgress(`Checking current transcript ${completed}/${total}…`),
      });
      const backupText = await withTimeout(file.text(), 5 * 60_000, 'Reading the backup file timed out after five minutes.');
      if (controller.signal.aborted) throw controller.signal.reason;
      const restored = mergeBackup(backupText, current, folders);
      const prepared = restored.meetings.map(ensureMeetingSummary);
      const archived = await archiveMeetingTranscriptsSequentially(prepared, {
        signal: controller.signal,
        maxDurationMs: BACKUP_JOB_MAX_MS,
        releaseVerifiedBodies: true,
        onArchiveError: (archiveError, meeting) => dlogError('backup.transcript.archive.fail', archiveError, { id: meeting.id }),
        onProgress: (completed, total, archivedMeeting) => {
          // Release each parsed backup body as soon as its verified archive is
          // committed. A failed archive retains the complete body inline.
          prepared[completed - 1] = archivedMeeting;
          setBackupProgress(`Securing restored transcript ${completed}/${total}…`);
        },
      });
      const unavailable = archived.find(hasUnavailableCompletedTranscript);
      if (unavailable) {
        throw new Error(`The backup does not contain a usable transcript body for “${unavailable.title || 'a meeting'}”. Nothing was imported.`);
      }
      persistMeetingList(archived);
      void indexedMeetingIds(archived).then(ids => setIndexedCount(ids.size)).catch(() => { /* semantic search remains optional */ });
      store.saveFolders(restored.folders);
      setFolders(restored.folders);
      if (restored.settings) setSettings(s => ({ ...s, ...restored.settings }));
      setNotice(`Backup restored — ${archived.length} meetings, ${restored.folders.length} folders.`);
      setTimeout(() => setNotice(''), 4000);
    } catch (err: any) {
      setError(`Import failed: ${err.message}`);
    } finally {
      if (backupAbortRef.current === controller) backupAbortRef.current = null;
      setBackupBusy(null);
      setBackupProgress('');
    }
  };

  const cancelBackup = () => {
    backupAbortRef.current?.abort(new Error('Backup processing was canceled. Verified transcript archives and complete inline content were kept; retry when ready.'));
  };

  /* Download Models via Workers */
  const dl = (type: 'whisper' | 'gemma' | 'embed') => {
    modelInitStartRef.current?.(type);
  };

  const handleOnboarding = () => {
    setHasOnboarded(true);
    localStorage.setItem('mg_onb', '1');
    setNotice('You’re ready. Optional model downloads stay off until you choose them in AI Models.');
    setTimeout(() => setNotice(''), 6000);
  };

  /* Audio Visualizer Loop — three gold themes: bars, wave, circle */
  const drawWaveform = () => {
    if (!analyserRef.current || !dataArrayRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const data = dataArrayRef.current;
    analyserRef.current.getByteFrequencyData(data as any);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
    gradient.addColorStop(0, '#a17a26');
    gradient.addColorStop(0.5, '#d4af37');
    gradient.addColorStop(1, '#fef3c7');

    const theme = settingsRef.current.vizTheme;
    if (theme === 'wave') {
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const step = canvas.width / data.length;
      for (let i = 0; i < data.length; i++) {
        const y = canvas.height / 2 + ((data[i] - 128) / 255) * canvas.height * 0.9
          * Math.sin(i / data.length * Math.PI); // taper the edges
        if (i === 0) ctx.moveTo(0, y); else ctx.lineTo(i * step, y);
      }
      ctx.stroke();
    } else if (theme === 'circle') {
      const cx = canvas.width / 2, cy = canvas.height / 2;
      const base = Math.min(cx, cy) * 0.45;
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2;
      for (let i = 0; i < data.length; i++) {
        const angle = (i / data.length) * Math.PI * 2;
        const len = base + (data[i] / 255) * (Math.min(cx, cy) - base - 2);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * base, cy + Math.sin(angle) * base);
        ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
        ctx.stroke();
      }
    } else {
      const barWidth = 4;
      const gap = 3;
      const bars = Math.floor(canvas.width / (barWidth + gap));
      for (let i = 0; i < bars; i++) {
        const percent = data[i * 2] / 255;
        const height = Math.max(4, percent * canvas.height);
        const x = i * (barWidth + gap);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, (canvas.height / 2) - (height / 2), barWidth, height, 2);
        ctx.fill();
      }
    }
    animFrameRef.current = requestAnimationFrame(drawWaveform);
  };

  const cycleVizTheme = () => {
    const order: Settings['vizTheme'][] = ['bars', 'wave', 'circle'];
    setSettings(s => ({ ...s, vizTheme: order[(order.indexOf(s.vizTheme) + 1) % order.length] }));
  };

  /* Recording — segmented save-first.
     The meeting record exists from second zero; audio streams to durable
     storage in 15s native or ≤60s web verified segments while recording. */
  const start = async (syntheticStream?: MediaStream) => {
    if (recorderRef.current?.isActive || startingRecordingRef.current) return; // no concurrent sessions
    startingRecordingRef.current = true;
    const useNativeCapture = Capacitor.isNativePlatform() && !syntheticStream;
    if (transcribingIdRef.current) {
      setNotice('Transcription is running — it will continue in the background while you record.');
      setTimeout(() => setNotice(''), 4000);
    }
    if (useNativeCapture) {
      void withTimeout(Haptics.impact({ style: ImpactStyle.Heavy }), 2_000, 'Haptic feedback timed out.')
        .catch(() => { /* optional and never allowed to block recording */ });
    }
    setError(''); setTranscript(''); setSummary(''); setTime(0); setSavedFlash('');
    transcriptRef.current = ''; summaryRef.current = '';

    let stream: MediaStream | null = null;
    if (!useNativeCapture) {
      try {
        stream = syntheticStream || await acquireMicrophoneStream(
          navigator.mediaDevices.getUserMedia({ audio: true }),
        );
      } catch (e) {
        dlogError('rec.permission.denied', e);
        setError('Microphone access denied. Allow microphone access for this site and try again.');
        startingRecordingRef.current = false;
        return;
      }
    }

    const id = Date.now().toString();
    const date = new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    currentMeetingRef.current = { id, date, dur: 0 };
    save({ id, date, dur: 0, title: 'Untitled Meeting', transcript: '', summary: '', status: 'recording', audioKind: 'segments', segments: 0, segmentIds: [], bytes: 0 });
    dlog('meeting.created', { id });

    const callbacks: RecorderCallbacks = {
      onSegmentSaved: (_info) => {
        updateMeeting(id, {
          segments: rec.segmentIds.length,
          segmentIds: [...rec.segmentIds],
          bytes: rec.totalBytes,
          dur: Math.round(rec.recordedMs / 1000),
          mimeType: rec.mimeType,
        });
        setAudioIds(prev => new Set(prev).add(id));
        void refreshStorageInfo();
      },
      onSegmentFailed: (seg, err) => {
        setError(`Audio segment ${seg + 1} failed to save (${err}). Previously saved audio is intact.`);
        updateMeeting(id, { diag: `segment ${seg} write failed: ${err}` });
      },
      onStorageWarning: (freeB) => {
        setNotice(`Storage is getting low — ${Math.round(freeB / 1048576)} MB free. Recording continues; consider freeing space.`);
        setTimeout(() => setNotice(''), 8000);
      },
      onAutoStop: (reason) => { setError(reason); void stop(); },
      onInterruption: (kind) => {
        dlog('rec.interruption.ui', { kind });
        setNotice('Audio input was interrupted (call, Siri, or route change). Completed audio is saved.');
        setTimeout(() => setNotice(''), 6000);
      },
      onMemoryPressure: (level) => {
        setNotice(`The device reported memory pressure (${String(level)}). Native recording continues and every finalized segment remains safe.`);
        setTimeout(() => setNotice(''), 8000);
      },
    };
    const rec = useNativeCapture
      ? new NativeSegmentedRecorder(id, callbacks, {
          storageWarnBytes: STORAGE_WARN_BYTES,
          storageStopBytes: STORAGE_STOP_BYTES,
          log: dlog,
          logError: dlogError,
        })
      : new SegmentedRecorder(id, callbacks, {
          writeSegment,
          freeBytes,
          storageWarnBytes: STORAGE_WARN_BYTES,
          storageStopBytes: STORAGE_STOP_BYTES,
          log: dlog,
          logError: dlogError,
        });
    recorderRef.current = rec;

    const startupTimeout = 'Recording startup did not complete within 30 seconds.';
    try {
      if (rec instanceof NativeSegmentedRecorder) {
        await withTimeout(rec.start(), 30_000, startupTimeout);
      } else if (stream) {
        await withTimeout(rec.start(stream), 30_000, startupTimeout);
      }
      else throw new Error('The microphone stream was unavailable.');
    } catch (e: unknown) {
      stream?.getTracks().forEach(t => t.stop());
      recorderRef.current = null;
      const message = e instanceof Error ? e.message : String(e);
      currentMeetingRef.current = null;
      if (message === startupTimeout) {
        const stopped = await withTimeout(
          rec.stop(),
          30_000,
          'Timed-out recorder shutdown did not complete within 30 seconds.',
        ).catch(stopError => {
          dlogError('rec.start.timeout.stop.fail', stopError, { id });
          return null;
        });
        const manifests = await withTimeout(
          listStoredAudioManifests(),
          30_000,
          'Timed-out recorder storage reconciliation did not complete within 30 seconds.',
        ).catch(scanError => {
          dlogError('rec.start.timeout.scan.fail', scanError, { id });
          return null;
        });
        const recovery = recordingStartupRecovery(id, stopped, manifests, message);
        if (recovery.kind === 'empty') {
          await remove(id);
          setError('Recording could not start within 30 seconds. No audio was captured; check microphone access and try again.');
        } else {
          updateMeeting(id, recovery.patch);
          if (recovery.kind === 'recovered') {
            setAudioIds(previous => new Set(previous).add(id));
            setError('Recording startup timed out, but verified audio was recovered in History. Check playback, then tap Retry Transcription.');
          } else {
            setError('Recording startup needs recovery. Reopen the app to reconcile protected storage; no recording data was deleted.');
          }
        }
      } else {
        await remove(id); // native/web start returned a terminal failure before capture
        setError(useNativeCapture && /permission|denied/i.test(message)
          ? 'Microphone access denied. Open Settings → MeetingGhost → enable Microphone, then return here and try again.'
          : message);
      }
      startingRecordingRef.current = false;
      return;
    }

    // Visualizer (display only — independent of the recording path)
    try {
      if (!stream) throw new Error('Native capture does not expose microphone samples to the WebView.');
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      drawWaveform();
    } catch { /* viz is optional */ }

    setRecording(true);
    startingRecordingRef.current = false;
    timerRef.current = window.setInterval(() => setTime(t => t + 1), 1000);
    void refreshStorageInfo();
  };

  const stop = async () => {
    const activeRecorder = recorderRef.current;
    if (activeRecorder instanceof NativeSegmentedRecorder) {
      void withTimeout(Haptics.impact({ style: ImpactStyle.Medium }), 2_000, 'Haptic feedback timed out.')
        .catch(() => { /* optional and never allowed to delay audio finalization */ });
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecording(false);
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => { /* */ }); audioCtxRef.current = null; }
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const rec = activeRecorder;
    const m = currentMeetingRef.current;
    if (!rec || !m) return;

    setProcessing(true);
    setProcStatus('Finalizing recording…');
    // Waits for the in-flight segment AND every verified write to durable storage
    let result;
    try {
      result = await withTimeout(
        rec.stop(),
        30_000,
        'Recording finalization did not complete within 30 seconds.',
      );
    } catch (e) {
      recorderRef.current = null;
      const message = e instanceof Error ? e.message : String(e);
      const recoveredIds = await withTimeout(
        listSegmentsOnDisk(m.id),
        30_000,
        'Saved-audio recovery also timed out.',
      ).catch(() => normalizedSegmentIds(getMeeting(m.id)?.segmentIds, getMeeting(m.id)?.segments || 0));
      updateMeeting(m.id, {
        status: 'recovery_required',
        segments: recoveredIds.length,
        segmentIds: recoveredIds,
        diag: `${message} Reopen the app to finalize recovery; every committed segment remains safe.`,
      });
      setError(`${message} Every completed audio segment remains safe. Reopen the app, then Retry from History.`);
      setProcessing(false);
      return;
    }
    recorderRef.current = null;
    const dur = Math.round(result.recordedMs / 1000);

    if (result.segments === 0 || result.totalBytes === 0) {
      updateMeeting(m.id, { status: 'recovery_required', dur, diag: 'The microphone produced no data — nothing could be saved.' });
      setError('No audio was captured. Check that the microphone works and permissions are granted.');
      setProcessing(false);
      return;
    }

    updateMeeting(m.id, {
      status: 'saved', dur, segments: result.segments, segmentIds: result.segmentIds,
      bytes: result.totalBytes, mimeType: result.mimeType,
      diag: result.failedSegments.length ? `${result.failedSegments.length} audio segment write(s) failed; all other verified segments remain playable and transcribable.` : undefined,
    });
    dlog('meeting.saved', { id: m.id, segments: result.segments, bytes: result.totalBytes, dur });
    setSavedFlash(`Recording safely saved — ${fmt(dur)}, ${(result.totalBytes / 1048576).toFixed(1)} MB in ${result.segments} segment${result.segments > 1 ? 's' : ''}. Transcription is a separate step and can always be retried.`);
    // Transcription: separate stage over saved audio only
    void runTranscription(m.id);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // allow re-uploading the same file
    setError(''); setTranscript(''); setSummary(''); setTime(0); setSavedFlash('');
    transcriptRef.current = ''; summaryRef.current = '';

    const id = Date.now().toString();
    const date = new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    currentMeetingRef.current = { id, date, dur: 0 };
    setProcessing(true);
    setProcStatus('Saving audio…');
    save({ id, date, dur: 0, title: 'Untitled Meeting', transcript: '', summary: '', status: 'recording', audioKind: 'segments', segments: 0, segmentIds: [], bytes: 0 });
    try {
      await withTimeout(
        writeSegment(id, 0, file),
        120_000,
        'Saving imported audio timed out. The import was not queued for transcription; retry the import after checking free storage.',
      ); // durable + verified before anything else
      updateMeeting(id, { status: 'saved', segments: 1, segmentIds: [0], bytes: file.size, mimeType: file.type || 'audio/mp4' });
      setAudioIds(prev => new Set(prev).add(id));
      setSavedFlash('Audio saved — starting transcription.');
      void runTranscription(id);
    } catch (err: unknown) {
      updateMeeting(id, { status: 'recovery_required', diag: `import failed: ${err instanceof Error ? err.message : String(err)}` });
      setError(`Could not save the imported audio: ${err instanceof Error ? err.message : String(err)}`);
      setProcessing(false);
    }
  };

  const beginAudioImport = async () => {
    if (!Capacitor.isNativePlatform()) {
      fileInputRef.current?.click();
      return;
    }

    setError(''); setTranscript(''); setSummary(''); setTime(0); setSavedFlash('');
    transcriptRef.current = ''; summaryRef.current = '';
    const id = Date.now().toString();
    const date = new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    currentMeetingRef.current = { id, date, dur: 0 };
    setProcessing(true);
    setProcStatus('Choose an audio file…');
    save({
      id, date, dur: 0, title: 'Imported Meeting', transcript: '', summary: '',
      status: 'recording', audioKind: 'segments', segments: 0, segmentIds: [], bytes: 0,
      diag: 'Native audio import is waiting for file selection or copy completion.',
    });

    const progressListenerPromise = NativeAudioImport.addListener('progress', event => {
      if (event.meetingId !== id) return;
      const copied = event.bytes >= 1048576
        ? `${(event.bytes / 1048576).toFixed(1)} MB`
        : `${Math.round(event.bytes / 1024)} KB`;
      setProcStatus(event.phase === 'finalizing'
        ? `Verifying ${copied} imported audio…`
        : event.phase === 'failed'
          ? 'Audio import stopped safely — no partial file was published.'
          : `Copying imported audio to protected storage… ${copied}`);
    });
    const progressListener = await withTimeout(
      progressListenerPromise,
      5_000,
      'Audio import progress listener did not attach within 5 seconds.',
    ).catch(listenerError => {
      dlogError('import.native.listener.attach.fail', listenerError, { id });
      // If the bridge resolves after our terminal attach deadline, detach that
      // stale listener immediately instead of leaking it into a later import.
      void progressListenerPromise.then(listener => withTimeout(
        listener.remove(),
        5_000,
        'Late audio import listener cleanup timed out.',
      )).catch(error => dlogError('import.native.listener.late_cleanup.fail', error, { id }));
      return null;
    });
    try {
      // The OS picker is intentionally not timed out while the user is making
      // a choice. Once selected, native code enforces a ten-minute copy
      // deadline, storage floor, fsync, atomic rename, and exact byte check.
      const imported = await NativeAudioImport.pick({ meetingId: id });
      const title = imported.displayName.replace(/\.[^.]+$/, '').trim() || 'Imported Meeting';
      updateMeeting(id, {
        status: 'saved',
        title,
        segments: 1,
        segmentIds: [imported.segmentId],
        bytes: imported.bytes,
        mimeType: imported.mimeType || 'audio/*',
        diag: undefined,
      });
      setAudioIds(previous => new Set(previous).add(id));
      setSavedFlash(`Audio saved directly to protected storage (${(imported.bytes / 1048576).toFixed(1)} MB) — starting bounded transcription.`);
      dlog('import.native.saved', { id, bytes: imported.bytes, mimeType: imported.mimeType });
      void runTranscription(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      currentMeetingRef.current = null;
      const canceled = /canceled|cancelled|IMPORT_CANCELED/i.test(message);
      if (canceled) {
        await remove(id);
        setProcessing(false);
        setProcStatus('');
      } else {
        dlogError('import.native.fail', error, { id });
        setProcStatus('Checking protected storage for completed audio…');
        try {
          const manifests = await withTimeout(
            listStoredAudioManifests(),
            30_000,
            'The import failed and its protected-audio recovery scan timed out.',
          );
          const recovered = recoveredImportPatch(id, manifests, message);
          if (recovered) {
            updateMeeting(id, recovered);
            setAudioIds(previous => new Set(previous).add(id));
            setError('The import response was interrupted, but the complete verified audio file was recovered. Use playback to check it, then tap Transcribe Audio.');
            dlog('import.native.recovered', { id, segments: recovered.segments, bytes: recovered.bytes });
          } else {
            await remove(id);
            setError(message);
          }
        } catch (scanError) {
          // An uncertain scan must never authorize deletion. Keep the visible
          // shell so relaunch can retry the authoritative storage scan.
          const scanMessage = scanError instanceof Error ? scanError.message : String(scanError);
          updateMeeting(id, {
            status: 'recovery_required',
            diag: `${message} Protected-storage recovery could not be completed: ${scanMessage}. Reopen the app; no recording data was deleted.`,
          });
          setError(`Import needs recovery: ${scanMessage} No recording data was deleted.`);
          dlogError('import.native.recovery_scan.fail', scanError, { id });
        } finally {
          setProcessing(false);
          setProcStatus('');
        }
      }
    } finally {
      if (progressListener) {
        await withTimeout(
          progressListener.remove(),
          5_000,
          'Audio import listener cleanup did not complete within 5 seconds.',
        ).catch(error => dlogError('import.native.listener.cleanup.fail', error, { id }));
      }
    }
  };

  /* Keep the screen awake while recording or transcribing — iOS aggressively
     suspends the WebView when the screen locks, which was silently killing
     long transcriptions. No-op where the Wake Lock API is unavailable. */
  useEffect(() => {
    if (recording || processing) {
      (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } })
        .wakeLock?.request('screen')
        .then(lock => { wakeLockRef.current = lock; })
        .catch(() => { /* unsupported or low battery — fine */ });
    } else {
      wakeLockRef.current?.release().catch(() => { /* already released */ });
      wakeLockRef.current = null;
    }
  }, [recording, processing]);

  const fmt = formatDuration;

  const clip = async (t: string) => {
    try {
      await withTimeout(navigator.clipboard.writeText(t), 10_000, 'Copying the transcript timed out.');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (copyError) {
      setError(`Copy failed: ${copyError instanceof Error ? copyError.message : String(copyError)} Use Export to save the complete transcript instead.`);
      dlogError('export.clipboard.fail', copyError);
    }
  };

  const downloadDiagnostics = async () => {
    if (diagnosticsBusy) return;
    setDiagnosticsBusy(true);
    setError('');
    try {
      const json = await withTimeout(
        exportDiagnostics(APP_VERSION),
        60_000,
        'Diagnostics collection reached its one-minute safety limit.',
      );
      downloadBlob(
        new Blob([json], { type: 'application/json' }),
        `MeetingGhost-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}.json`,
      );
      setNotice('Privacy-safe diagnostics exported. Meeting titles and content were excluded.');
      setTimeout(() => setNotice(''), 5000);
    } catch (diagnosticError) {
      setError(`Diagnostics export stopped: ${diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)} Retry after reopening the app if the device remains busy.`);
      dlogError('diagnostics.export.fail', diagnosticError);
    } finally {
      setDiagnosticsBusy(false);
    }
  };

  const shareWasCanceled = (error: unknown) => /cancel|dismiss|abort/i.test(error instanceof Error ? error.message : String(error));

  const meetingWithTranscript = async (meeting: MeetingRecord): Promise<MeetingRecord> => {
    assertMeetingTranscriptExportable(meeting);
    let complete = meeting;
    if (meeting.transcript) {
      complete = { ...meeting, ...assertTranscriptIntegrity(meeting.transcript, meeting) };
    } else if (meeting.transcriptStored) {
      const archived = await loadMeetingTranscript(meeting.id, meeting);
      if (!archived) throw new Error('Export stopped because the archived transcript could not be loaded. The recording remains safe; retry after reopening the app.');
      complete = { ...meeting, transcript: archived, ...transcriptIntegrity(archived) };
    } else if (meeting.transcriptOutcome === 'no_speech') {
      complete = { ...meeting, ...assertTranscriptIntegrity('', meeting) };
    }
    const summarized = ensureMeetingSummary(complete);
    if (summarized !== complete) {
      updateMeeting(summarized.id, {
        title: summarized.title,
        summary: summarized.summary,
        actionItems: summarized.actionItems,
      });
      setNotice('A complete private summary was restored before export.');
      setTimeout(() => setNotice(''), 4000);
    }
    // A completed empty transcript is the explicit no-speech outcome.
    return summarized;
  };

  const share = async (t: string, title = 'MeetingGhost Meeting') => {
    const safeTitle = title.replace(/[^a-z0-9-_ ]/gi, '').trim().slice(0, 60) || 'MeetingGhost';
    const fileName = `${safeTitle}.txt`;
    try {
      if (Capacitor.isNativePlatform()) {
        const path = `exports/${safeTitle}-${Date.now()}.txt`;
        const uri = await prepareVerifiedNativeShareFile({
          path, data: t, format: 'utf8', label: 'transcript',
        });
        await Share.share({ title, files: [uri], dialogTitle: 'Send complete transcript to another app' });
        return;
      }
      const file = new File([t], fileName, { type: 'text/plain' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title, files: [file] });
        return;
      }
    } catch (e) {
      if (shareWasCanceled(e)) return;
      dlogError('export.share.text.fail', e);
      if (Capacitor.isNativePlatform()) {
        setError(`Transcript export failed before sharing: ${e instanceof Error ? e.message : String(e)}. No truncated text was sent.`);
        return;
      }
    }
    downloadBlob(new Blob([t], { type: 'text/plain' }), fileName);
  };

  const shareMeeting = async (meeting: MeetingRecord) => {
    try {
      meeting = await meetingWithTranscript(meeting);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const markdown = meetingToMarkdown(meeting);
    const safeTitle = (meeting.title || 'MeetingGhost-Meeting').replace(/[^a-z0-9-_ ]/gi, '').trim().slice(0, 60) || 'MeetingGhost-Meeting';
    if (!Capacitor.isNativePlatform()) {
      const file = new File([markdown], `${safeTitle}.md`, { type: 'text/markdown' });
      try {
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ title: meeting.title || 'MeetingGhost Meeting', text: 'Meeting notes and transcript', files: [file] });
          return;
        }
      } catch (e) {
        if (shareWasCanceled(e)) return;
        dlogError('export.share.webfile.fail', e, { id: meeting.id });
      }
      await share(markdown, meeting.title || 'MeetingGhost Meeting');
      return;
    }
    try {
      const path = `exports/${safeTitle}-${meeting.id}.md`;
      const uri = await prepareVerifiedNativeShareFile({
        path, data: markdown, format: 'utf8', label: 'Markdown',
      });
      await Share.share({
        title: meeting.title || 'MeetingGhost Meeting',
        text: 'Meeting notes, summary, action items, and full transcript.',
        files: [uri],
        dialogTitle: 'Send meeting to another app',
      });
    } catch (e) {
      if (shareWasCanceled(e)) return;
      dlogError('export.share.fail', e, { id: meeting.id });
      setError(`Meeting export failed before sharing: ${e instanceof Error ? e.message : String(e)}. No incomplete fallback was sent.`);
    }
  };

  const exportPDF = async (m: MeetingRecord) => {
    try {
      m = await meetingWithTranscript(m);
      const doc = buildMeetingPdf(m);
      const safeTitle = (m.title || m.id).replace(/[^a-z0-9-_ ]/gi, '').trim().slice(0, 60) || m.id;
      const fileName = `MeetingGhost-${safeTitle}.pdf`;
      if (!Capacitor.isNativePlatform()) {
        doc.save(fileName);
        return;
      }
      const dataUri = doc.output('datauristring');
      const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
      const path = `exports/${fileName}`;
      const uri = await prepareVerifiedNativeShareFile({
        path, data: base64, format: 'base64', label: 'PDF',
      });
      await Share.share({ title: m.title || 'MeetingGhost Meeting', files: [uri], dialogTitle: 'Send complete meeting PDF to another app' });
    } catch (e) {
      if (shareWasCanceled(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const exportMD = async (m: MeetingRecord) => {
    if (Capacitor.isNativePlatform()) {
      await shareMeeting(m);
      return;
    }
    try {
      m = await meetingWithTranscript(m);
      downloadBlob(
        new Blob([meetingToMarkdown(m)], { type: 'text/markdown' }),
        `MeetingGhost-${m.title || m.id}.md`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /* ─── v8.0 Integrations ─── */
  const exportToGitHub = async (m: MeetingRecord) => {
    const s = settingsRef.current;
    if (!s.githubToken || !s.githubRepo) {
      setTab('settings');
      setNotice('Add your GitHub token and repository in Settings first.');
      setTimeout(() => setNotice(''), 4000);
      return;
    }
    try {
      m = await meetingWithTranscript(m);
      const url = await createGitHubIssue(s.githubToken, s.githubRepo, m);
      setNotice(`GitHub issue created: ${url}`);
      setTimeout(() => setNotice(''), 6000);
    } catch (e: any) {
      setError(`GitHub export failed: ${e.message}`);
    }
  };

  const downloadICS = async (m: MeetingRecord) => {
    try {
      m = await meetingWithTranscript(m);
      downloadBlob(
        new Blob([buildFollowUpICS(m)], { type: 'text/calendar' }),
        `MeetingGhost-FollowUp-${m.id}.ics`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const emailDraft = async (m: MeetingRecord) => {
    try {
      m = await meetingWithTranscript(m);
      const mailto = buildMailto(m);
      // Mail clients impose inconsistent URL limits. Never silently slice the
      // summary: use the verified complete Markdown handoff when a draft URL
      // would exceed the conservative cross-client boundary.
      if (mailto.length > 1800) {
        setNotice('This email draft is too long for a safe mail link, so the complete meeting will open in the app share sheet instead.');
        setTimeout(() => setNotice(''), 6000);
        await shareMeeting(m);
        return;
      }
      window.location.href = mailto;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const revealMeetingTranscript = async (meeting: MeetingRecord) => {
    setTranscriptLoadingIds(current => new Set(current).add(meeting.id));
    try {
      const hydrated = await meetingWithTranscript(meeting);
      // Merge only the verified body/integrity into current live metadata;
      // edits made while the archive read was in flight remain authoritative.
      const updated = meetingsRef.current.map(current => current.id === meeting.id
        ? mergeHydratedMeetingContent(current, hydrated)
        : current);
      meetingsRef.current = updated;
      setMeetings(updated);
    } catch (transcriptError) {
      setError(transcriptError instanceof Error ? transcriptError.message : String(transcriptError));
    } finally {
      setTranscriptLoadingIds(current => {
        const next = new Set(current);
        next.delete(meeting.id);
        return next;
      });
    }
  };

  const hideMeetingTranscript = (meetingId: string) => {
    const updated = meetingsRef.current.map(meeting => meeting.id === meetingId && meeting.transcriptStored
      ? { ...meeting, transcript: '' }
      : meeting);
    meetingsRef.current = updated;
    setMeetings(updated);
  };

  const indexableCount = indexableMeetingCount(meetings);
  const transcriptionSetupNeeded = !whisper.done && (
    !Capacitor.isNativePlatform() || nativeSTT?.available === false
  );
  const normalizedHistoryQuery = searchQuery.trim().toLowerCase();
  const filteredMeetings = meetings.filter(m =>
    (activeFolder === 'all' || m.folderId === activeFolder) &&
    (!normalizedHistoryQuery ||
     m.title?.toLowerCase().includes(normalizedHistoryQuery) ||
     historySearchMatches.has(m.id))
  );

  return (
    <div className="app-shell">
      {!hasOnboarded && (
        <div
          className="onboarding-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-title"
          aria-describedby="onboarding-description"
          onKeyDown={event => {
            if (event.key === 'Tab') {
              event.preventDefault();
              onboardingButtonRef.current?.focus();
            }
          }}
        >
          <div className="onboarding-modal">
            <div className="onboarding-mark" aria-hidden="true"><ShieldCheck /></div>
            <h2 id="onboarding-title">Your meetings, safely captured</h2>
            <p id="onboarding-description">Record conversations with automatic save checkpoints, then create a transcript and practical private summary. Optional model downloads only start when you choose them.</p>
            <div className="onboarding-points">
              <span><Mic /> Record with automatic save checkpoints</span>
              <span><Brain /> Transcribe and summarize on your device</span>
              <span><Search /> Search every saved conversation</span>
            </div>
            <button ref={onboardingButtonRef} className="btn-primary" onClick={handleOnboarding}>
              <ShieldCheck /> Get Started Privately
            </button>
          </div>
        </div>
      )}

      {/* Noise texture overlay for metal feel */}
      <div className="noise-overlay" />

      {/* ═══ HEADER ═══ */}
      <header className="header">
        <div className="brand">
          <div className="brand-logo"><Award /></div>
          <div className="brand-info">
            <h1>
              <span className="brand-name">MEETINGGHOST</span>
              <span className="brand-badge">GOLD</span>
            </h1>
            <p className="brand-tagline"><ShieldCheck />Private On-Device Voice Intelligence</p>
          </div>
        </div>
        <nav className="nav-tabs" aria-label="Primary navigation">
          <button aria-current={tab === 'studio' ? 'page' : undefined} className={`nav-tab${tab === 'studio' ? ' active' : ''}`} onClick={() => setTab('studio')}>
            <Mic />Studio
          </button>
          <button aria-current={tab === 'history' ? 'page' : undefined} className={`nav-tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
            <Clock />History{meetings.length > 0 && ` (${meetings.length})`}
          </button>
          <button aria-current={tab === 'ask' ? 'page' : undefined} className={`nav-tab${tab === 'ask' ? ' active' : ''}`} onClick={() => setTab('ask')}>
            <MessageSquare />Ask
          </button>
          <button aria-current={tab === 'models' ? 'page' : undefined} className={`nav-tab${tab === 'models' ? ' active' : ''}`} onClick={() => setTab('models')}>
            <Zap />AI Models
          </button>
          <button aria-current={tab === 'settings' ? 'page' : undefined} className={`nav-tab${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>
            <SettingsIcon />Settings
          </button>
        </nav>
      </header>

      <main className="main">
        {notice && <div className="notice-banner" role="status" aria-live="polite">{notice}</div>}
        {error && tab !== 'studio' && <div className="error-banner" role="alert" style={{ maxWidth: 'none' }}>{error}</div>}

        {/* ═══ HERO CARD ═══ */}
        {tab === 'studio' && <section className="hero">
          <div className="hero-texture" style={{ backgroundImage: `url(${goldBg})` }} />
          <div className="hero-shimmer" />
          <div className="hero-content">
            <div className="hero-eyebrow"><Sparkles />On-Device Voice Intelligence</div>
            <h2 className="hero-heading">Private <em>meeting intelligence</em>, ready when you are</h2>
            <p className="hero-body">Record conversations, create complete transcripts and summaries, then share them with the app you choose. Core processing stays on your device; optional cloud refinement is off by default.</p>
          </div>
          <div className="hero-aside">
            <div className="stat-card">
              <div className="stat-icon"><HardDrive /></div>
              <div>
                <div className="stat-label">Privacy Default</div>
                <div className="stat-value">Local-first, no account required</div>
              </div>
            </div>
            <div className="platform-pill">
              {Capacitor.isNativePlatform()
                ? <><Smartphone />Capacitor ({Capacitor.getPlatform()})</>
                : <><Globe />PWA Web App</>
              }
            </div>
          </div>
        </section>}

        {/* ═══ STUDIO TAB ═══ */}
        {tab === 'studio' && (
          <div className="recorder-layout">
            {/* Voice Recorder Status */}
            <div className={`panel voice-panel${recording ? ' is-recording' : ''}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '16px' }}>
                <p className="voice-hint" style={{ margin: 0 }}>
                  {recording ? 'Recording live audio…' : 'Tap the golden mic to start recording'}
                </p>
                {!recording && (
                  <>
                    <input type="file" accept="audio/*" ref={fileInputRef} hidden onChange={handleFileUpload} />
                    <button className="upload-btn" onClick={() => void beginAudioImport()} title="Import Audio File" aria-label="Import an audio file">
                      <Upload /><span>Import audio</span>
                    </button>
                  </>
                )}
              </div>

              {!recording && transcriptionSetupNeeded && (
                <div className="transcription-setup-card" role="note">
                  <div>
                    <strong>Recording is ready; transcription needs one optional setup step</strong>
                    <p>Audio saves first even without the model. Download private voice-to-text now, or do it later from AI Models.</p>
                  </div>
                  <button className="btn-ghost" onClick={() => setTab('models')}><Download />Set Up Transcription</button>
                </div>
              )}

              {recording && (
                <div className="rec-chip" role="status" aria-label="Recording in progress" style={{ margin: '0 auto 16px auto' }}>
                  <div className="rec-dot" aria-hidden="true" />
                  <span className="rec-label" aria-hidden="true">REC {fmt(time)}</span>
                </div>
              )}

              {recording && Capacitor.isNativePlatform() && (
                <div className="storage-chip">
                  <ShieldCheck />
                  <span>Protected native capture · committing audio every {NATIVE_SEGMENT_SECONDS} seconds</span>
                </div>
              )}

              {recording && !Capacitor.isNativePlatform() && (
                <div className="waveform">
                  <canvas ref={canvasRef} width={200} height={44} style={{ width: '100%', height: '44px' }} />
                  <button className="btn-ghost viz-toggle" onClick={cycleVizTheme} title="Change visualizer theme">
                    <Sparkles />{settings.vizTheme}
                  </button>
                </div>
              )}

              {recording && storageInfo && (
                <div className="storage-chip">
                  <HardDrive />
                  <span>
                    {storageInfo.freeMB >= 1024 ? `${(storageInfo.freeMB / 1024).toFixed(1)} GB` : `${storageInfo.freeMB} MB`} free
                    {storageInfo.estMin !== null && storageInfo.estMin < 6000 && ` · ~${storageInfo.estMin >= 60 ? `${Math.floor(storageInfo.estMin / 60)}h ${storageInfo.estMin % 60}m` : `${storageInfo.estMin} min`} recordable`}
                  </span>
                </div>
              )}
              {processing && (
                <div className="processing-chip" role="status" aria-live="polite">
                  <Loader2 className="spin" />
                  <span>{procStatus || 'Processing on-device…'}</span>
                  {transcribingIdRef.current && (
                    <span className="proc-actions">
                      <button className="btn-ghost" onClick={pauseTranscription}>Pause</button>
                      <button className="btn-ghost" onClick={cancelTranscription}>Cancel</button>
                    </span>
                  )}
                </div>
              )}
              {savedFlash && (
                <div className="saved-banner" role="status" aria-live="polite"><CheckCircle2 />{savedFlash}</div>
              )}
              {error && <div className="error-banner" role="alert">{error}</div>}
            </div>

            {/* Transcript + Summary */}
            <div className="output-stack">
              <div className="panel transcript-panel">
                <div className="panel-top">
                  <div className="panel-label"><Brain />Live Transcript</div>
                  {transcript && (
                    <div className="btn-row">
                      <button
                        className={`btn-ghost${settings.highlightKeywords ? ' active-gold' : ''}`}
                        onClick={() => setSettings(s => ({ ...s, highlightKeywords: !s.highlightKeywords }))}
                        title="Highlight action words"
                        aria-label="Highlight action words"
                      >
                        <Highlighter />
                      </button>
                      <button className="btn-ghost" onClick={() => clip(transcript)}>
                        {copied ? <><Check />Copied</> : <><Copy />Copy</>}
                      </button>
                      <button className="btn-gold" onClick={() => share(transcript, 'MeetingGhost Transcript')}>
                        <Share2 />Export
                      </button>
                    </div>
                  )}
                </div>
                <div className="output-area">
                  {transcript
                    ? <div className="mono-block">{settings.highlightKeywords ? highlightKeywords(transcript) : transcript}</div>
                    : <div className="empty-placeholder">Transcript will appear here after recording</div>
                  }
                </div>
              </div>

              <div className="panel summary-panel">
                <div className="panel-label"><Sparkles />AI Meeting Summary</div>
                {summary
                  ? <div className="summary-block">{summary}</div>
                  : <div className="empty-placeholder">Summary generates after recording completes</div>
                }
              </div>
            </div>

            {/* Floating Action Area for Record Button */}
            <div className="floating-action-area">
              <div className="mic-orbit" style={{ margin: 0 }}>
                <div className="orbit-ring" />
                <div className="orbit-ring" />
                <div className="orbit-ring" />
                <button
                  className={`mic-btn${recording ? ' recording' : ' gold'}`}
                  onClick={() => { if (recording) void stop(); else void start(); }}
                  aria-label={recording ? 'Stop Recording' : 'Start Recording'}
                >
                  {recording ? <Square fill="currentColor" /> : <Mic />}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══ HISTORY TAB ═══ */}
        {tab === 'history' && (
          <section className="panel history-panel">
            <div className="section-heading" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock />
                <span className="gold-text">Saved Meetings ({meetings.length})</span>
              </div>
              <div className="btn-row">
                <input type="file" accept="application/json" ref={backupInputRef} hidden onChange={handleBackupImport} disabled={!!backupBusy} />
                <button className="btn-ghost" onClick={() => backupInputRef.current?.click()} title="Import backup JSON" disabled={!!backupBusy}>
                  {backupBusy === 'import' ? <Loader2 className="spin" /> : <Upload />}{backupBusy === 'import' ? 'Importing…' : 'Import'}
                </button>
                <button className="btn-ghost" onClick={downloadBackup} title="Export all data as JSON" disabled={!!backupBusy}>
                  {backupBusy === 'export' ? <Loader2 className="spin" /> : <DatabaseBackup />}{backupBusy === 'export' ? 'Backing Up…' : 'Backup'}
                </button>
                {backupBusy && <button className="btn-ghost" onClick={cancelBackup}><X />Cancel</button>}
              </div>
            </div>

            {backupBusy && <div className="saved-banner" role="status"><Loader2 className="spin" />{backupProgress}</div>}

            <div className="folder-bar">
              <button className={`folder-chip${activeFolder === 'all' ? ' active' : ''}`} onClick={() => setActiveFolder('all')}>
                <FolderIcon />All ({meetings.length})
              </button>
              {folders.map(f => (
                <span key={f.id} className={`folder-chip${activeFolder === f.id ? ' active' : ''}`}>
                  <button className="folder-chip-label" onClick={() => setActiveFolder(f.id)}>
                    <FolderIcon />{f.name} ({meetings.filter(m => m.folderId === f.id).length})
                  </button>
                  <button className="folder-chip-x" onClick={() => deleteFolder(f.id)} title={`Delete folder "${f.name}"`} aria-label={`Remove folder ${f.name}; meetings will stay saved`}>
                    <X />
                  </button>
                </span>
              ))}
              <button className="folder-chip new" onClick={createFolder} title="New folder">
                <FolderPlus />New
              </button>
            </div>

            {meetings.length > 0 && (
              <div className="history-controls">
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search meetings by title or transcript..."
                  value={searchQuery}
                  aria-label="Search saved meetings by title or transcript"
                  aria-busy={historySearchState === 'loading'}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            )}

            {historySearchState === 'loading' && normalizedHistoryQuery && (
              <div className="saved-banner" role="status"><Loader2 className="spin" />Searching complete saved transcripts one at a time… {historySearchProgress.completed}/{historySearchProgress.total}</div>
            )}
            {historySearchState === 'error' && (
              <div className="error-banner" role="alert">
                History search stopped rather than omitting an unavailable transcript: {historySearchError}
                <button className="btn-ghost" onClick={() => setHistorySearchRetry(value => value + 1)}><RefreshCw />Retry Search</button>
              </div>
            )}

            {filteredMeetings.length === 0 && historySearchState === 'loading' ? null : filteredMeetings.length === 0 ? (
              <div className="history-empty">
                <div className="history-empty-icon"><Search /></div>
                <p>No meetings found.</p>
              </div>
            ) : (
              <div className="history-stack">
                {filteredMeetings.map(m => (
                  <div key={m.id} className="history-row">
                    <div className="history-row-top">
                      <div className="history-meta">
                        <strong style={{ color: 'var(--gold-200)', display: 'block', fontSize: '18px', lineHeight: 1.35 }}>{m.title || 'Untitled Meeting'}</strong>
                        <span className="history-date">{m.date}</span>
                        <span className="history-dur">Duration: {fmt(m.dur)}</span>
                        {m.status === 'recording' && (
                          <span className="status-chip processing"><Mic />Recording… {m.segments || 0} segment{(m.segments || 0) !== 1 ? 's' : ''} saved</span>
                        )}
                        {(m.status === 'saved' || m.status === 'queued') && !m.transcript && (
                          <span className="status-chip saved"><CheckCircle2 />Audio saved{m.status === 'queued' ? ' — queued for transcription' : ' — not yet transcribed'}</span>
                        )}
                        {m.status === 'transcribing' && (
                          <span className="status-chip processing"><Loader2 className="spin" />{transcribingIdRef.current === m.id ? (procStatus || 'Transcribing…') : 'Transcribing…'}</span>
                        )}
                        {m.status === 'transcription_interrupted' && (
                          <span className="status-chip error">
                            Transcription interrupted
                            {typeof m.tSubNext === 'number' && m.tSubTotal
                              ? ` at audio part ${(m.tSubSegment || 0) + 1}/${m.segments || 1}, chunk ${Math.min(m.tSubNext + 1, m.tSubTotal)}/${m.tSubTotal}`
                              : typeof m.tNext === 'number' && m.segments ? ` at ${Math.min(m.tNext + 1, m.segments)}/${m.segments}` : ''}
                            {' — resumable'}
                          </span>
                        )}
                        {m.status === 'transcription_failed' && (
                          <span className="status-chip error">Transcription failed after {m.retries} tries — audio intact</span>
                        )}
                        {m.status === 'recovery_required' && (
                          <span className="status-chip error">Recording/import recovery required — no data was deleted</span>
                        )}
                        {m.status === 'complete' && !m.transcript && m.transcriptStored && (
                          <span className="status-chip saved"><CheckCircle2 />Complete transcript securely archived — load on demand</span>
                        )}
                        {m.status === 'complete' && !m.transcript && !m.transcriptStored && m.transcriptOutcome === 'no_speech' && (
                          <span className="status-chip saved"><CheckCircle2 />Audio saved — no speech detected</span>
                        )}
                        {m.status === 'complete' && !m.transcript && !m.transcriptStored && m.transcriptOutcome !== 'no_speech' && (
                          <span className="status-chip error">Transcript outcome unverified — recreate it from saved audio</span>
                        )}
                      </div>
                      <div className="history-btns">
                        {folders.length > 0 && (
                          <select
                            className="folder-select"
                            value={m.folderId || ''}
                            onChange={(e) => moveToFolder(m.id, e.target.value)}
                            title="Move to folder"
                            aria-label={`Move ${m.title || 'meeting'} to a folder`}
                          >
                            <option value="">No folder</option>
                            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                        )}
                        <button className="btn-sq" data-label="PDF" onClick={() => exportPDF(m)} title="Export PDF" aria-label="Export meeting as PDF"><FileText /></button>
                        <button className="btn-sq" data-label="Markdown" onClick={() => exportMD(m)} title="Export Markdown" aria-label="Export meeting as Markdown"><Download /></button>
                        <button className="btn-sq" data-label="GitHub" onClick={() => exportToGitHub(m)} title="Export Action Items to GitHub Issue" aria-label="Export action items to GitHub"><CircleDot /></button>
                        <button className="btn-sq" data-label="Calendar" onClick={() => downloadICS(m)} title="Add Follow-up to Calendar (.ics)" aria-label="Add a calendar follow-up"><CalendarPlus /></button>
                        <button className="btn-sq" data-label="Email" onClick={() => emailDraft(m)} title="Draft Email" aria-label="Draft a meeting email"><Mail /></button>
                        <button className="btn-sq" data-label="Share" onClick={() => shareMeeting(m)} title="Send Meeting to Another App" aria-label="Send meeting to another app"><Share2 /></button>
                        <button
                          className="btn-sq del"
                          data-label="Delete"
                          onClick={() => void remove(m.id, true)}
                          title="Delete"
                          aria-label={`Delete ${m.title || 'meeting'}`}
                          disabled={deletingIds.has(m.id)}
                        >
                          {deletingIds.has(m.id) ? <Loader2 className="spin" /> : <Trash2 />}
                        </button>
                      </div>
                    </div>
                    {m.transcript ? (
                      <>
                        {m.transcriptStored && (
                          <button className="btn-ghost summary-create-btn" onClick={() => hideMeetingTranscript(m.id)}><X />Hide Transcript</button>
                        )}
                        <div className="history-snippet">{m.transcript}</div>
                      </>
                    ) : m.transcriptStored && m.transcriptOutcome === 'text' ? (
                      <button
                        className="btn-ghost summary-create-btn"
                        onClick={() => void revealMeetingTranscript(m)}
                        disabled={transcriptLoadingIds.has(m.id)}
                      >
                        {transcriptLoadingIds.has(m.id) ? <Loader2 className="spin" /> : <FileText />}
                        {transcriptLoadingIds.has(m.id) ? 'Loading Complete Transcript…' : 'View Complete Transcript'}
                      </button>
                    ) : null}
                    {m.summary ? (
                      <div className="history-summary">
                        <div className="panel-label"><Sparkles />Meeting Summary</div>
                        <div className="summary-block">{m.summary}</div>
                      </div>
                    ) : m.transcript ? (
                      <button className="btn-ghost summary-create-btn" onClick={() => createSavedSummary(m)}>
                        <Sparkles />Create Private Summary
                      </button>
                    ) : null}
                    {m.diag && !m.transcript && <div className="diag-line">{m.diag}</div>}
                    {!m.transcript && audioIds.has(m.id) &&
                      ['saved', 'queued', 'transcription_interrupted', 'transcription_failed', 'complete', 'error'].includes(m.status || '') && (
                        <button className="btn-gold retry-btn" onClick={() => retryTranscription(m)}>
                          <RefreshCw />{typeof m.tSubNext === 'number' && m.tSubTotal
                            ? `Resume Transcription (audio chunk ${Math.min(m.tSubNext + 1, m.tSubTotal)}/${m.tSubTotal})`
                            : typeof m.tNext === 'number' && m.tNext > 0
                              ? `Resume Transcription (from ${m.tNext + 1}/${m.segments})`
                              : m.status === 'complete' ? 'Recreate Transcript from Audio' : 'Transcribe Audio'}
                        </button>
                      )}
                    {audioIds.has(m.id) && (
                      <AudioPlayer meetingId={m.id} segments={m.audioKind === 'segments' ? (m.segments || 0) : 0} segmentIds={m.segmentIds} mimeType={m.mimeType || 'audio/mp4'} />
                    )}
                    {m.actionItems && m.actionItems.length > 0 && (
                      <div className="action-items">
                        <div className="action-items-label"><ListChecks />Action Items</div>
                        {m.actionItems.map((it, i) => (
                          <label key={i} className={`action-item${it.done ? ' done' : ''}`}>
                            <input type="checkbox" checked={it.done} onChange={() => toggleActionItem(m.id, i)} />
                            <span>{it.text}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ═══ ASK TAB ═══ */}
        {tab === 'ask' && (
          <section className="panel ask-panel">
            <div className="section-heading">
              <MessageSquare />
              <span className="gold-text">Ask Your Meetings</span>
            </div>
            <p className="ai-intro">
              Search every saved conversation. Full-text search works immediately; the optional semantic model also finds related ideas and concepts.
            </p>

            {!embedder.done && (
              <div className="search-upgrade">
                <div>
                  <strong>Full-text search is ready</strong>
                  <p>Optional: add the {embedder.size} semantic model for meaning-based matches.</p>
                </div>
                {embedder.loading ? (
                  <div className="progress-wrap" style={{ marginTop: 10 }}>
                    <div className="progress-top"><span>Preparing semantic search…</span><span>{embedder.progress}%</span></div>
                    <div className="progress-track" role="progressbar" aria-label="Preparing semantic search" aria-valuemin={0} aria-valuemax={100} aria-valuenow={embedder.progress}>
                      <div className="progress-bar" style={{ width: `${embedder.progress}%` }} />
                    </div>
                  </div>
                ) : (
                  <div className="model-retry">
                    {embedder.error && <p className="model-error" role="alert">{embedder.error}</p>}
                    <button className="btn-ghost" onClick={() => dl('embed')}>
                      <Download />{embedder.error ? 'Retry Improve Search' : 'Improve Search'}
                    </button>
                  </div>
                )}
              </div>
            )}
            <>
                <div className="ask-bar">
                  <input
                    type="text"
                    className="search-input"
                    placeholder='e.g. "What did we decide about the marketing budget?"'
                    value={askQuery}
                    aria-label="Ask a question across saved meetings"
                    aria-busy={askBusy}
                    onChange={e => setAskQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') ask(); }}
                  />
                  <button className="btn-gold" onClick={ask} disabled={askBusy}>
                    {askBusy ? <Loader2 className="spin" /> : <Sparkles />}Ask
                  </button>
                </div>

                {askBusy && <div className="saved-banner" role="status"><Loader2 className="spin" />{askProgress}</div>}

                {askAnswer && (
                  <div className="ask-answer">
                    <div className="panel-label"><Sparkles />Answer</div>
                    <div className="summary-block">{askAnswer}</div>
                  </div>
                )}

                {askSources.length > 0 && (
                  <div className="ask-sources">
                    <div className="panel-label"><Search />Sources</div>
                    {askSources.map((s, i) => (
                      <div key={i} className="ask-source">
                        <strong>{s.title}</strong> <span className="history-date">{s.date}</span>
                        <p>{s.text}</p>
                      </div>
                    ))}
                  </div>
                )}
            </>
          </section>
        )}

        {/* ═══ AI MODELS TAB ═══ */}
        {tab === 'models' && (
          <section className="panel ai-panel">
            <div className="section-heading">
              <Zap />
              <span className="gold-text">AI Model Manager</span>
            </div>
            <p className="ai-intro">
              Optional AI engines are downloaded only when you choose them. Core recording, private summaries, and full-text search remain available without optional models.
            </p>
            <div className="models-grid">
              {nativeSTT?.available && (
                <div className="model-tile">
                  <div>
                    <div className="model-top">
                      <div className="model-name">{Capacitor.getPlatform() === 'android' ? 'Android On-device Speech' : 'Apple Speech'} (built-in)</div>
                      <div className="model-size">no download</div>
                    </div>
                    <p className="model-info">
                      Transcription runs natively on this device using
                      {Capacitor.getPlatform() === 'android'
                        ? ' Android’s support-checked offline speech service'
                        : nativeSTT.engine === 'SpeechAnalyzer' ? " Apple's iOS 26 SpeechAnalyzer" : ' Apple speech recognition'} —
                      100% on-device, audio never leaves your phone.
                    </p>
                  </div>
                  <div className="model-done"><CheckCircle2 />Built-in & Ready</div>
                </div>
              )}
              {([
                // A verified native engine replaces Whisper; unsupported Android devices retain the WASM fallback.
                ...(nativeSTT?.available ? [] : [{ m: whisper, t: 'whisper' as const, d: 'Provides 100% private, offline speech-to-text transcription directly on your device.' }]),
                { m: gemma, t: 'gemma' as const, d: 'Generates private meeting minutes, key action items, and executive summaries on-device.' },
                { m: embedder, t: 'embed' as const, d: 'Powers semantic search and "Ask your meetings" — finds moments by meaning, not just keywords.' },
              ]).map(({ m, t, d }) => {
                const gpuBlocked = t === 'gemma' && !hasWebGPU;
                return (
                <div key={t} className="model-tile">
                  <div>
                    <div className="model-top">
                      <div className="model-name">{m.name}</div>
                      <div className="model-size">{m.size}</div>
                    </div>
                    <p className="model-info">{d}</p>
                  </div>
                  {gpuBlocked ? (
                    <div className="model-info" style={{ opacity: 0.7 }}>
                      Requires WebGPU, which this device/browser doesn't support yet. Complete private summaries still work; only optional AI refinement is unavailable.
                    </div>
                  ) : m.done ? (
                    <div className="model-done"><CheckCircle2 />Installed & Ready</div>
                  ) : m.loading ? (
                    <div className="progress-wrap">
                      <div className="progress-top"><span>Preparing…</span><span>{m.progress}%</span></div>
                      <div className="progress-track" role="progressbar" aria-label={`Preparing ${m.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.progress}>
                        <div className="progress-bar" style={{ width: `${m.progress}%` }} />
                      </div>
                    </div>
                  ) : (
                    <div className="model-retry">
                      {m.error && <p className="model-error" role="alert">{m.error}</p>}
                      <button className="btn-download" onClick={() => dl(t)}>
                        <Download />{m.error ? `Retry (${m.size})` : `Download (${m.size})`}
                      </button>
                    </div>
                  )}
                </div>
              ); })}
            </div>

            {embedder.done && indexableCount > 0 && (
              <div className="settings-group" style={{ marginTop: 16 }}>
                <h3 className="settings-label"><RefreshCw style={{ width: 14, height: 14 }} /> Semantic Index</h3>
                <p className="settings-hint">
                  {indexedCount} of {indexableCount} transcribed meetings indexed for "Ask Your Meetings". New recordings index automatically.
                </p>
                {indexing && <p className="settings-hint" role="status">{indexProgress}</p>}
                <div className="btn-row">
                  <button className="btn-download" onClick={indexAll} disabled={indexing || indexedCount >= indexableCount}>
                    {indexing ? <Loader2 className="spin" /> : <RefreshCw />}
                    {indexing ? 'Indexing…' : indexedCount > 0 ? 'Index Remaining Meetings' : 'Index All Meetings'}
                  </button>
                  {indexing && <button className="btn-ghost" onClick={cancelIndexAll}><X />Cancel Indexing</button>}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ═══ SETTINGS TAB ═══ */}
        {tab === 'settings' && (
          <section className="panel settings-panel">
            <div className="section-heading">
              <SettingsIcon />
              <span className="gold-text">Settings</span>
            </div>

            <div className="settings-group">
              <label className="settings-label" htmlFor="summary-template">Summary Template</label>
              <p className="settings-hint">Shapes what the AI focuses on when summarizing your meetings.</p>
              <select
                id="summary-template"
                className="folder-select settings-select"
                value={settings.template}
                onChange={e => setSettings(s => ({ ...s, template: e.target.value as Settings['template'] }))}
              >
                {Object.entries(TEMPLATES).map(([k, t]) => (
                  <option key={k} value={k}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="settings-group">
              <label className="settings-label" htmlFor="claude-api-key"><KeyRound style={{ width: 14, height: 14 }} /> Claude API — Premium Summaries (optional)</label>
              <p className="settings-hint">
                By default everything runs 100% on-device. If you want MeetGeek-quality structured summaries,
                paste your own Anthropic API key. The transcript is then sent directly from your device to
                Anthropic — never through any MeetingGhost server. The key is stored only on this device and
                is excluded from backups.
              </p>
              <input
                id="claude-api-key"
                type="password"
                className="search-input"
                placeholder="sk-ant-..."
                value={settings.claudeKey}
                onChange={e => setSettings(s => ({ ...s, claudeKey: e.target.value.trim() }))}
                autoComplete="off"
              />
              <label className="action-item" style={{ marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={settings.useCloud}
                  onChange={e => setSettings(s => ({ ...s, useCloud: e.target.checked }))}
                  disabled={!settings.claudeKey}
                />
                <span>Use Claude for summaries when available (falls back to on-device if it fails)</span>
              </label>
            </div>

            <div className="settings-group">
              <div className="settings-label"><CircleDot style={{ width: 14, height: 14 }} /> GitHub Integration (optional)</div>
              <p className="settings-hint">
                Export a meeting's action items as a GitHub issue (one issue per meeting, with a
                task-list checklist). Needs a fine-grained personal access token with Issues write
                access. The token stays on this device and is excluded from backups.
              </p>
              <input
                id="github-repository"
                type="text"
                className="search-input"
                placeholder="owner/repository (e.g. acme/meeting-actions)"
                value={settings.githubRepo}
                onChange={e => setSettings(s => ({ ...s, githubRepo: e.target.value.trim() }))}
                autoComplete="off"
                aria-label="GitHub repository in owner slash repository format"
              />
              <input
                id="github-token"
                type="password"
                className="search-input"
                style={{ marginTop: 8 }}
                placeholder="github_pat_... or ghp_..."
                value={settings.githubToken}
                onChange={e => setSettings(s => ({ ...s, githubToken: e.target.value.trim() }))}
                autoComplete="off"
                aria-label="GitHub personal access token"
              />
            </div>

            <div className="settings-group">
              <h3 className="settings-label"><HardDrive style={{ width: 14, height: 14 }} /> Diagnostics</h3>
              <p className="settings-hint" data-testid="installed-build">
                Installed build: <strong>{APP_VERSION}</strong> · {Capacitor.getPlatform()}
              </p>
              <p className="settings-hint">
                Exports a local log of app events (recording states, segment writes, storage,
                worker status, errors) for troubleshooting. It never contains your audio,
                transcripts, or meeting titles.
              </p>
              <button className="btn-download" onClick={() => void downloadDiagnostics()} disabled={diagnosticsBusy}>
                {diagnosticsBusy ? <Loader2 className="spin" /> : <Download />}
                {diagnosticsBusy ? 'Collecting Diagnostics…' : 'Export Diagnostics'}
              </button>

              <div className="integrity-check">
                <h3 className="settings-label"><ShieldCheck />Meeting Intelligence Integrity Check</h3>
                <p className="settings-hint">
                  Uses synthetic two-hour content to verify this device’s real audio storage/decode,
                  metadata-loss recovery, transcript archive/hydration, private summary, cross-meeting
                  search, complete Markdown, and final-page PDF. It never reads or changes your saved meetings.
                </p>
                <button
                  className="btn-download"
                  onClick={() => void runIntegrityCheck()}
                  disabled={integrityBusy || recording || processing}
                >
                  {integrityBusy ? <Loader2 className="spin" /> : <ShieldCheck />}
                  {integrityBusy ? 'Checking complete meeting pipeline…' : 'Run Meeting Intelligence Check'}
                </button>
                {integrityResult && (
                  <div className={`integrity-result ${integrityResult.passed ? 'passed' : 'failed'}`} role="status">
                    <strong>{integrityResult.passed ? 'All integrity checks passed' : 'Integrity check needs attention'}</strong>
                    <span>{integrityResult.platform} · {new Date(integrityResult.finishedAt).toLocaleString()}</span>
                    <ul>
                      {integrityResult.steps.map(step => (
                        <li key={step.name} className={step.passed ? 'passed' : 'failed'}>
                          {step.passed ? <CheckCircle2 /> : <X />}
                          <span><strong>{step.name}</strong><small>{step.detail}</small></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 18 }}>
                <h3 className="settings-label"><RefreshCw style={{ width: 14, height: 14 }} /> Reliability Self-Test</h3>
                <p className="settings-hint">
                  Runs the full record → save → transcribe pipeline 25 times with synthesized
                  audio (no microphone needed) and verifies every recording is saved and
                  transcribed. Force-quitting the app mid-run is part of the test — it resumes
                  automatically and counts the recovery.
                </p>
                {selfTest && (
                  <p className="settings-hint" style={{ color: 'var(--gold-300)', fontWeight: 700 }}>
                    {selfTest.running
                      ? `Running — cycle ${Math.min(selfTest.cycle, selfTest.total)}/${selfTest.total}`
                      : `${selfTest.finishedAt ? 'Finished' : 'Stopped'} — ${selfTest.results.length}/${selfTest.total} cycles`}
                    {' · '}{summarize(selfTest).saved} saved · {summarize(selfTest).transcribed} transcribed · {selfTest.kills} kill-recover{selfTest.kills === 1 ? 'y' : 'ies'}
                  </p>
                )}
                {selfTest?.running ? (
                  <button className="btn-download" onClick={stopSelfTest}>Stop Self-Test (keeps results)</button>
                ) : (
                  <button className="btn-download" onClick={startSelfTest}><RefreshCw />Run 25× Reliability Self-Test</button>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
