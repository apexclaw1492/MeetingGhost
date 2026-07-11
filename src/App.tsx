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
import jsPDF from 'jspdf';
import goldBg from './assets/gold_bg.jpg';
import { getAudioData } from './utils/audio';
import { store, exportBackup, importBackup } from './utils/store';
import type { MeetingRecord, Folder, Settings } from './utils/store';
import { highlightKeywords } from './utils/highlight';
import { TEMPLATES, localSummaryPrompt, parseActionItems, summarizeWithClaude, askWithClaude, chatSystemPrompt, chatUserPrompt } from './utils/intelligence';
import type { TemplateKey } from './utils/intelligence';
import { chunkTranscript, saveMeetingVectors, deleteMeetingVectors, indexedMeetingIds, searchVectors } from './utils/vectors';
import type { Chunk } from './utils/vectors';
import { createGitHubIssue, buildFollowUpICS, buildMailto, meetingToMarkdown } from './utils/integrations';
import { idb } from './utils/idb';
import { AudioPlayer } from './components/AudioPlayer';
import { SegmentedRecorder, SEGMENT_MS } from './utils/recorder';
import { writeSegment, readSegment, segmentNativePath, countSegmentsOnDisk, deleteMeetingAudio, freeBytes, STORAGE_WARN_BYTES } from './utils/audioStore';
import { log as dlog, logError as dlogError, exportDiagnostics } from './utils/diag';
import { loadSelfTest, saveSelfTest, newSelfTest, makeTestStream, writeResultsFile, summarize } from './utils/selftest';
import type { SelfTestState } from './utils/selftest';
import './App.css';

export const APP_VERSION = 'v11.0';

/* Native on-device transcription (ios/App/App/NativeSTTPlugin.swift).
   On iOS, ML inference inside WKWebView trips the process memory ceiling and
   kills the app — transcription runs in native memory instead. Whisper-WASM
   remains the web engine. */
const NativeSTT = registerPlugin<{
  available(): Promise<{ available: boolean; engine?: string }>;
  transcribeFile(options: { path: string }): Promise<{ text: string; engine?: string }>;
}>('NativeSTT');

interface Model {
  name: string;
  size: string;
  done: boolean;
  loading: boolean;
  progress: number;
}

/* WebGPU is required by the WebLLM summarizer; absent on most iOS/Android WebViews */
const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

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
  const [searchQuery, setSearchQuery] = useState('');
  const [tab, setTab] = useState<'studio' | 'history' | 'ask' | 'models' | 'settings'>('studio');
  const [askQuery, setAskQuery] = useState('');
  const [askAnswer, setAskAnswer] = useState('');
  const [askSources, setAskSources] = useState<{ title: string; date: string; text: string }[]>([]);
  const [askBusy, setAskBusy] = useState(false);
  const [indexedCount, setIndexedCount] = useState(0);
  const [indexing, setIndexing] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>('all');
  const [settings, setSettings] = useState<Settings>(() => store.loadSettings());
  const [notice, setNotice] = useState('');

  const [whisper, setWhisper] = useState<Model>({
    name: 'Whisper Voice-to-Text', size: '141 MB', done: false, loading: false, progress: 0
  });
  const [gemma, setGemma] = useState<Model>({
    name: 'Gemma 3 Summarizer', size: '253 MB', done: false, loading: false, progress: 0
  });
  const [embedder, setEmbedder] = useState<Model>({
    name: 'Semantic Search Engine', size: '25 MB', done: false, loading: false, progress: 0
  });

  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const settingsRef = useRef<Settings>(settings);
  useEffect(() => { settingsRef.current = settings; store.saveSettings(settings); }, [settings]);

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
  const embedderStateRef = useRef<Model>(embedder);
  const chatResolverRef = useRef<((text: string) => void) | null>(null);
  const [audioIds, setAudioIds] = useState<Set<string>>(new Set());
  const [procStatus, setProcStatus] = useState('');
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  useEffect(() => { embedderStateRef.current = embedder; }, [embedder]);

  /* v10 reliability: segmented recorder + resumable transcription queue */
  const recorderRef = useRef<SegmentedRecorder | null>(null);
  const transcribeResolveRef = useRef<((text: string) => void) | null>(null);
  const transcribeRejectRef = useRef<((e: Error) => void) | null>(null);
  const queueFlagsRef = useRef<{ cancel: boolean; pause: boolean }>({ cancel: false, pause: false });
  const transcribingIdRef = useRef<string | null>(null);
  const [storageInfo, setStorageInfo] = useState<{ freeMB: number; estMin: number | null } | null>(null);
  const [savedFlash, setSavedFlash] = useState(''); // "recording safely saved" confirmation
  const [selfTest, setSelfTest] = useState<SelfTestState | null>(null);
  const selfTestBusyRef = useRef(false);
  const [nativeSTT, setNativeSTT] = useState<{ available: boolean; engine?: string } | null>(null);
  const nativeSTTRef = useRef<{ available: boolean; engine?: string } | null>(null);
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
    let whisperWasDone = false;
    let gemmaWasDone = false;
    let embedderWasDone = false;
    let autoResumeTimer: number | undefined;
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
          switch (m.status) {
            case 'done': return { ...m, audioKind, status: 'complete' as const };
            case 'processing': case 'error':
              return { ...m, audioKind, status: 'transcription_interrupted' as const, recovered: m.status === 'processing' };
            case 'queued': case 'transcribing':
              return { ...m, audioKind, status: 'transcription_interrupted' as const, recovered: true };
            case 'recording':
              // Reconciled against segments on disk below (async)
              return { ...m, audioKind, status: 'recovery_required' as const, recovered: true };
            default: return { ...m, audioKind };
          }
        });
        localStorage.setItem('mg_h', JSON.stringify(loaded));
        setMeetings(loaded);

        // Disk reconciliation: a meeting killed mid-recording keeps every
        // segment that was flushed+verified; only sub-60s tail can be missing.
        loaded.filter(m => m.status === 'recovery_required').forEach(async (m) => {
          const segs = await countSegmentsOnDisk(m.id);
          dlog('recover.recording', { id: m.id, segsOnDisk: segs, segsBelieved: m.segments || 0 });
          if (segs > 0) {
            updateMeeting(m.id, {
              segments: segs,
              status: 'transcription_interrupted',
              diag: `Recovered after interruption: ${segs} audio segment(s) preserved. Up to ${Math.round(SEGMENT_MS / 1000)}s of trailing audio may be missing.`,
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
          autoResumeTimer = window.setTimeout(() => {
            const fresh = (JSON.parse(localStorage.getItem('mg_h') || '[]') as MeetingRecord[]).find(x => x.id === resumable.id);
            if (fresh && fresh.status === 'transcription_interrupted' && whisperStateRef.current.done && !transcribingIdRef.current) {
              setNotice('Resuming the interrupted transcription automatically — your audio is safe either way.');
              setTimeout(() => setNotice(''), 7000);
              void retryTranscription(fresh);
            }
          }, 8000); // let the whisper re-warm settle first
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

    // Initialize Web Workers
    whisperWorkerRef.current = new Worker(new URL('./workers/whisper.worker.ts', import.meta.url), { type: 'module' });
    llmWorkerRef.current = new Worker(new URL('./workers/llm.worker.ts', import.meta.url), { type: 'module' });
    embedWorkerRef.current = new Worker(new URL('./workers/embed.worker.ts', import.meta.url), { type: 'module' });

    embedWorkerRef.current.onmessage = (e) => {
      const { status, progress, requestId, vectors, message } = e.data;
      if (status === 'progress') {
        setEmbedder(prev => prev.done ? prev : { ...prev, loading: true, progress });
      } else if (status === 'ready') {
        setEmbedder(prev => {
          const next = { ...prev, loading: false, done: true, progress: 100 };
          localStorage.setItem('mg_e', JSON.stringify(next));
          return next;
        });
      } else if (status === 'embedded') {
        embedRequestsRef.current.get(requestId)?.resolve(vectors);
        embedRequestsRef.current.delete(requestId);
      } else if (status === 'error') {
        if (requestId !== undefined) {
          embedRequestsRef.current.get(requestId)?.reject(new Error(message));
          embedRequestsRef.current.delete(requestId);
        } else {
          setEmbedder(prev => ({ ...prev, loading: false }));
        }
      }
    };

    whisperWorkerRef.current.onmessage = (e) => {
      const { status, progress, text, message, current, total } = e.data;
      if (status === 'progress') {
        // Don't flip an installed model back to "Downloading…" during silent re-warm
        setWhisper(prev => prev.done ? prev : { ...prev, loading: true, progress });
      } else if (status === 'ready') {
        setWhisper(prev => {
          const next = { ...prev, loading: false, done: true, progress: 100 };
          localStorage.setItem('mg_w', JSON.stringify(next));
          return next;
        });
      } else if (status === 'transcribe_progress') {
        setProcStatus(prev => {
          const seg = prev.match(/^Transcribing (\d+\/\d+)/)?.[1];
          return `Transcribing ${seg || ''} — ${Math.round((current / total) * 100)}%`.replace('  ', ' ');
        });
      } else if (status === 'complete') {
        // Settled by the transcription queue (runTranscription) — one segment done
        transcribeResolveRef.current?.(text);
        transcribeResolveRef.current = null;
        transcribeRejectRef.current = null;
      } else if (status === 'error') {
        transcribeRejectRef.current?.(new Error(message));
        transcribeResolveRef.current = null;
        transcribeRejectRef.current = null;
      }
    };

    // A crashed worker must surface, never hang the queue forever
    whisperWorkerRef.current.onerror = (e) => {
      dlogError('worker.whisper.crash', e.message || 'worker error');
      transcribeRejectRef.current?.(new Error(`Transcription worker crashed: ${e.message || 'unknown'}`));
      transcribeResolveRef.current = null;
      transcribeRejectRef.current = null;
    };

    llmWorkerRef.current.onmessage = (e) => {
      const { status, progress, text, message } = e.data;
      if (status === 'progress') {
        setGemma(prev => prev.done ? prev : { ...prev, loading: true, progress });
      } else if (status === 'ready') {
        setGemma(prev => {
          const next = { ...prev, loading: false, done: true, progress: 100 };
          localStorage.setItem('mg_g', JSON.stringify(next));
          return next;
        });
      } else if (status === 'complete') {
        setSummary(text);
        summaryRef.current = text;
        const m = currentMeetingRef.current;
        if (m) updateMeeting(m.id, { summary: text, actionItems: parseActionItems(text) });
        // Now ask for title
        setProcStatus('Naming meeting…');
        llmWorkerRef.current?.postMessage({ type: 'autoTitle', text });
      } else if (status === 'chat_complete') {
        chatResolverRef.current?.(text);
        chatResolverRef.current = null;
      } else if (status === 'title_complete') {
        setProcessing(false);
        const m = currentMeetingRef.current;
        if (m) updateMeeting(m.id, { title: text });
      } else if (status === 'error') {
        // Transcript is already saved; the summary is an enhancement, not a gate.
        setNotice(`Summarizer unavailable (${message}) — transcript saved without a summary.`);
        setTimeout(() => setNotice(''), 5000);
        setProcessing(false);
      }
    };

    // Models persisted as installed are cached by the browser — re-warm the
    // workers so transcription/summarization actually work after a reload.
    // Native STT probe: on iOS the native engine replaces Whisper-WASM
    // (whisper worker stays cold there — it is the crash source).
    let nativeSTTAvailable = false;
    const warmWhisper = () => {
      if (whisperWasDone && !nativeSTTAvailable) whisperWorkerRef.current?.postMessage({ type: 'init' });
    };
    if (Capacitor.isNativePlatform()) {
      NativeSTT.available()
        .then(res => {
          nativeSTTAvailable = !!res.available;
          setNativeSTT(res);
          nativeSTTRef.current = res;
          dlog('nativestt.probe', { ...res });
          warmWhisper();
        })
        .catch(() => { setNativeSTT({ available: false }); warmWhisper(); });
    } else {
      warmWhisper();
    }
    if (gemmaWasDone && hasWebGPU) llmWorkerRef.current.postMessage({ type: 'init' });
    if (embedderWasDone) embedWorkerRef.current.postMessage({ type: 'init' });

    indexedMeetingIds().then(ids => setIndexedCount(ids.size)).catch(() => { /* noop */ });
    // Playable audio: legacy IDB blobs/segments AND meetings with verified segments
    idb.keys('audio').then(keys => setAudioIds(prev => {
      const n = new Set(prev);
      keys.forEach(k => n.add(String(k).split(':')[0]));
      try {
        (JSON.parse(localStorage.getItem('mg_h') || '[]') as MeetingRecord[])
          .filter(m => (m.segments || 0) > 0).forEach(m => n.add(m.id));
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
      }).then(l => { appListener = l; }).catch(() => { /* noop */ });
    }
    dlog('app.launch', { version: APP_VERSION, platform: Capacitor.getPlatform() });

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

    return () => {
      whisperWorkerRef.current?.terminate();
      llmWorkerRef.current?.terminate();
      embedWorkerRef.current?.terminate();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      appListener?.remove();
      if (selfTestTimer !== undefined) clearTimeout(selfTestTimer);
      if (autoResumeTimer !== undefined) clearTimeout(autoResumeTimer);
    };
  }, []);

  /* localStorage is written SYNCHRONOUSLY (it is the durable source of truth
     the recovery/queue logic reads via getMeeting) — React state follows.
     Persisting inside the batched state updater caused a race where code
     right after updateMeeting() read stale data and silently bailed. */
  const save = (r: MeetingRecord) => {
    const u = [r, ...store.loadMeetings()];
    localStorage.setItem('mg_h', JSON.stringify(u));
    setMeetings(u);
  };

  const updateMeeting = (id: string, patch: Partial<MeetingRecord>) => {
    const u = store.loadMeetings().map(m => m.id === id ? { ...m, ...patch } : m);
    localStorage.setItem('mg_h', JSON.stringify(u));
    setMeetings(u);
  };

  /* ─── v10 transcription queue ───
     A separate, resumable stage that operates ONLY on already-saved audio.
     One segment at a time (bounded memory), checkpointed after every segment,
     resumable from tNext after any interruption. Failure never touches audio. */

  const getMeeting = (id: string): MeetingRecord | undefined => {
    try { return (JSON.parse(localStorage.getItem('mg_h') || '[]') as MeetingRecord[]).find(x => x.id === id); }
    catch { return undefined; }
  };

  const transcribeFloat32 = (audio: Float32Array): Promise<string> =>
    new Promise((resolve, reject) => {
      transcribeResolveRef.current = resolve;
      transcribeRejectRef.current = reject;
      // Transfer (not copy) the buffer — matters on memory-tight WKWebView
      whisperWorkerRef.current?.postMessage({ type: 'transcribe', audio }, [audio.buffer]);
    });

  const runTranscription = async (id: string) => {
    const m = getMeeting(id);
    if (!m || !m.segments) {
      // Never leave an endless spinner: surface the inconsistent state
      if (m) updateMeeting(id, { status: 'transcription_interrupted', diag: 'No audio segments were found for this meeting when transcription started.' });
      setProcessing(false);
      return;
    }
    if (transcribingIdRef.current) {
      updateMeeting(id, { status: 'queued' });
      setNotice('Another transcription is running — this recording is queued (audio is safe).');
      setTimeout(() => setNotice(''), 5000);
      return;
    }
    const useNative = !!nativeSTTRef.current?.available;
    if (!useNative && !whisperStateRef.current.done) {
      updateMeeting(id, { status: 'transcription_interrupted', diag: 'Whisper model not installed — download it in AI Models, then tap Retry.' });
      setNotice('Recording saved. Install the Whisper model (AI Models tab) to transcribe it.');
      setTimeout(() => setNotice(''), 8000);
      return;
    }

    transcribingIdRef.current = id;
    queueFlagsRef.current = { cancel: false, pause: false };
    currentMeetingRef.current = { id, date: m.date, dur: m.dur };
    setProcessing(true);
    const total = m.segments;
    const parts = [...(m.tParts || [])];
    let next = m.tNext || 0;
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
        // Watchdog: a ≤60s segment must never hang the queue forever
        const stallGuard = new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('transcription stalled (5-minute timeout)')), 300_000));
        let text: string;
        if (useNative) {
          // Native engine reads the segment file directly — nothing large
          // crosses the WebView boundary, nothing is decoded in JS memory.
          const path = await segmentNativePath(id, next);
          if (!path) throw new Error(`audio segment ${next + 1} could not be located in storage`);
          const res = await Promise.race([NativeSTT.transcribeFile({ path }), stallGuard]);
          text = res.text;
        } else {
          const blob = await readSegment(id, next, m.mimeType || 'audio/mp4');
          if (!blob) throw new Error(`audio segment ${next + 1} could not be read from storage`);
          const audioF32 = await getAudioData([blob], 16000);
          if (next === 0 && !m.dur) {
            updateMeeting(id, { dur: Math.round((audioF32.length / 16000) * total) });
          }
          text = await Promise.race([transcribeFloat32(audioF32), stallGuard]);
        }
        parts[next] = (text || '').replace(/\[BLANK_AUDIO\]/g, '').trim();
        next++;
        // Checkpoint after EVERY segment — resume never repeats finished work
        updateMeeting(id, { tNext: next, tParts: parts });
        dlog('transcribe.segment.done', { id, seg: next - 1, chars: parts[next - 1].length });
      }

      const full = parts.join(' ').replace(/\s{2,}/g, ' ').trim();
      updateMeeting(id, {
        transcript: full, status: 'complete', tParts: undefined, tNext: undefined, retries: undefined,
        diag: full ? undefined : 'No speech detected in the audio — the recording is kept.',
      });
      setTranscript(full); transcriptRef.current = full;
      dlog('transcribe.complete', { id, chars: full.length });
      if (full) {
        indexMeeting({ id, transcript: full } as MeetingRecord).catch(() => { /* embedder optional */ });
        setProcStatus('Summarizing…');
        runSummarization(full); // llm/title flow clears `processing` when done
      } else {
        setProcessing(false);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const attemptNow = getMeeting(id)?.retries || 1;
      updateMeeting(id, {
        status: attemptNow >= 3 ? 'transcription_failed' : 'transcription_interrupted',
        tNext: next, tParts: parts, diag: msg,
      });
      dlogError('transcribe.fail', e, { id, at: next, attempt: attemptNow });
      setError(`Transcription stopped at segment ${next + 1}/${total}: ${msg}. Your audio is safe — Retry resumes from this point.`);
      setProcessing(false);
    } finally {
      transcribingIdRef.current = null;
      // A queued meeting (recorded while we were busy) starts automatically
      const queued = (JSON.parse(localStorage.getItem('mg_h') || '[]') as MeetingRecord[]).find(x => x.status === 'queued');
      if (queued && !queueFlagsRef.current.cancel) void runTranscription(queued.id);
    }
  };

  const retryTranscription = async (m: MeetingRecord) => {
    if (transcribingIdRef.current === m.id) return;
    // Legacy v9 meetings stored one blob under the plain id — migrate to seg-0
    if (m.audioKind === 'single' || !m.segments) {
      const legacy = await idb.get<Blob>('audio', m.id).catch(() => null);
      if (!legacy) { setError('No stored audio found for this meeting.'); return; }
      try {
        await writeSegment(m.id, 0, legacy);
        updateMeeting(m.id, { audioKind: 'segments', segments: 1, bytes: legacy.size, mimeType: legacy.type || 'audio/mp4' });
      } catch (e: unknown) {
        setError(`Could not prepare audio for retry: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    updateMeeting(m.id, { status: 'queued', diag: undefined });
    await runTranscription(m.id);
  };

  const pauseTranscription = () => { queueFlagsRef.current.pause = true; setProcStatus('Pausing after current segment…'); };
  const cancelTranscription = () => { queueFlagsRef.current.cancel = true; setProcStatus('Stopping — audio will be kept…'); };

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

  const awaitTerminal = async (id: string, maxSec: number): Promise<MeetingRecord | undefined> => {
    for (let t = 0; t < maxSec; t++) {
      const m = getMeeting(id);
      if (m && ['complete', 'transcription_failed', 'transcription_interrupted', 'recovery_required'].includes(m.status || '')) return m;
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
      if (!whisperStateRef.current.done) {
        dl('whisper');
        for (let t = 0; t < 600 && !whisperStateRef.current.done; t++) await sleep(1000);
      }

      // A cycle interrupted by a kill: finish it via the real recovery path
      if (st.activeMeetingId && !st.results.some(r => r.cycle === st.cycle)) {
        const m = getMeeting(st.activeMeetingId);
        if (m) {
          const t0 = performance.now();
          if (m.status !== 'complete' && (m.segments || 0) > 0) await retryTranscription(m);
          const done = await awaitTerminal(st.activeMeetingId, 300);
          st.results.push({
            cycle: st.cycle, resumedAfterKill: true,
            saved: (done?.segments || 0) > 0 && (done?.bytes || 0) > 0,
            transcribed: done?.status === 'complete',
            status: done?.status || 'missing', segments: done?.segments, bytes: done?.bytes, dur: done?.dur,
            ms: Math.round(performance.now() - t0),
          });
          remove(st.activeMeetingId);
          st = { ...st, cycle: st.cycle + 1, activeMeetingId: undefined };
          await persist();
        } else {
          // Meeting shell vanished — record the failure honestly
          st.results.push({ cycle: st.cycle, saved: false, transcribed: false, status: 'missing', ms: 0, resumedAfterKill: true });
          st = { ...st, cycle: st.cycle + 1, activeMeetingId: undefined };
          await persist();
        }
      }

      while (st.running && st.cycle <= st.total) {
        const t0 = performance.now();
        const { stream, dispose } = makeTestStream();
        const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async () => stream;
        try {
          await start();
          const id = currentMeetingRef.current?.id;
          st = { ...st, activeMeetingId: id };
          await persist();
          await sleep(st.recordSecs * 1000);
          await stop();
        } finally {
          navigator.mediaDevices.getUserMedia = origGUM;
        }
        const id = st.activeMeetingId;
        const m = id ? await awaitTerminal(id, 300) : undefined;
        dispose();
        st.results.push({
          cycle: st.cycle,
          saved: (m?.segments || 0) > 0 && (m?.bytes || 0) > 0,
          transcribed: m?.status === 'complete',
          status: m?.status || 'missing', segments: m?.segments, bytes: m?.bytes, dur: m?.dur,
          ms: Math.round(performance.now() - t0),
        });
        dlog('selftest.cycle', { ...st.results[st.results.length - 1] });
        if (id) remove(id); // keep the device clean across 25 runs
        st = { ...st, cycle: st.cycle + 1, activeMeetingId: undefined };
        await persist();
        // reload current selfTest 'running' flag in case the user pressed Stop
        const live = loadSelfTest();
        if (!live?.running) { st.running = false; break; }
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

  /* ─── Semantic indexing ─── */
  const embedTexts = (texts: string[]): Promise<number[][]> => {
    return new Promise((resolve, reject) => {
      if (!embedWorkerRef.current || !embedderStateRef.current.done) {
        reject(new Error('Embedder not installed'));
        return;
      }
      const requestId = ++embedRequestSeqRef.current;
      embedRequestsRef.current.set(requestId, { resolve, reject });
      embedWorkerRef.current.postMessage({ type: 'embed', texts, requestId });
    });
  };

  const indexMeeting = async (r: MeetingRecord) => {
    if (!r.transcript?.trim()) return;
    const chunks = chunkTranscript(r.transcript);
    const vectors = await embedTexts(chunks);
    await saveMeetingVectors(r.id, chunks.map((text, chunkIndex) => ({ text, chunkIndex, vector: vectors[chunkIndex] })));
    const ids = await indexedMeetingIds();
    setIndexedCount(ids.size);
  };

  const indexAll = async () => {
    setIndexing(true);
    try {
      const done = await indexedMeetingIds();
      for (const m of meetings) {
        if (!done.has(m.id)) await indexMeeting(m);
      }
    } catch (e: any) {
      setError(`Indexing failed: ${e.message}`);
    } finally {
      setIndexing(false);
    }
  };

  /* ─── Ask your meetings ─── */
  const ask = async () => {
    const q = askQuery.trim();
    if (!q || askBusy) return;
    setAskBusy(true); setAskAnswer(''); setAskSources([]); setError('');
    try {
      const [qv] = await embedTexts([q]);
      const hits = await searchVectors(qv, 5);
      if (hits.length === 0) {
        setAskAnswer('No indexed meetings yet. Record a meeting, or press "Index All" in the AI Models tab.');
        return;
      }
      const byId = new Map(meetings.map(m => [m.id, m]));
      const excerpts = hits.map((c: Chunk) => {
        const m = byId.get(c.meetingId);
        return { title: m?.title || 'Untitled Meeting', date: m?.date || '', text: c.text };
      });
      setAskSources(excerpts);

      const s = settingsRef.current;
      if (s.useCloud && s.claudeKey) {
        setAskAnswer(await askWithClaude(s.claudeKey, q, excerpts));
      } else if (llmWorkerRef.current && gemmaStateRef.current.done) {
        const answer = await new Promise<string>((resolve) => {
          chatResolverRef.current = resolve;
          llmWorkerRef.current!.postMessage({ type: 'chat', text: chatUserPrompt(q, excerpts), systemPrompt: chatSystemPrompt() });
        });
        setAskAnswer(answer);
      } else {
        setAskAnswer('Found these relevant excerpts (install the Summarizer model or add a Claude key in Settings for AI answers):');
      }
    } catch (e: any) {
      setAskAnswer('');
      setError(`Ask failed: ${e.message}`);
    } finally {
      setAskBusy(false);
    }
  };

  /* Route summarization: BYO-key Claude when enabled, else the local LLM worker */
  const runSummarization = (text: string) => {
    const s = settingsRef.current;
    const m = currentMeetingRef.current;
    if (s.useCloud && s.claudeKey) {
      summarizeWithClaude(s.claudeKey, text, s.template as TemplateKey)
        .then(r => {
          setSummary(r.summary);
          summaryRef.current = r.summary;
          setProcessing(false);
          if (m) updateMeeting(m.id, { title: r.title, summary: r.summary, actionItems: r.actionItems });
        })
        .catch(err => {
          // Cloud failed (bad key, offline, rate limit) — fall back to local
          setNotice(`Claude request failed (${err?.message || 'error'}) — falling back to on-device summarizer.`);
          setTimeout(() => setNotice(''), 5000);
          runLocalSummarization(text);
        });
    } else {
      runLocalSummarization(text);
    }
  };

  const runLocalSummarization = (text: string) => {
    if (llmWorkerRef.current && gemmaStateRef.current.done) {
      llmWorkerRef.current.postMessage({
        type: 'summarize', text,
        systemPrompt: localSummaryPrompt(settingsRef.current.template as TemplateKey),
      });
    } else {
      // No summarizer available — transcript is already saved, we're done.
      setProcessing(false);
    }
  };

  const toggleActionItem = (meetingId: string, index: number) => {
    setMeetings(prev => {
      const u = prev.map(m => {
        if (m.id !== meetingId || !m.actionItems) return m;
        const items = m.actionItems.map((it, i) => i === index ? { ...it, done: !it.done } : it);
        return { ...m, actionItems: items };
      });
      store.saveMeetings(u);
      return u;
    });
  };

  const remove = (id: string) => {
    setMeetings(prev => {
      const u = prev.filter(m => m.id !== id);
      localStorage.setItem('mg_h', JSON.stringify(u));
      return u;
    });
    deleteMeetingVectors(id)
      .then(() => indexedMeetingIds())
      .then(ids => setIndexedCount(ids.size))
      .catch(() => { /* noop */ });
    deleteMeetingAudio(id)
      .then(() => setAudioIds(prev => { const n = new Set(prev); n.delete(id); return n; }))
      .catch(() => { /* noop */ });
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
    setFolders(prev => {
      const u = prev.filter(f => f.id !== id);
      store.saveFolders(u);
      return u;
    });
    setMeetings(prev => {
      const u = prev.map(m => m.folderId === id ? { ...m, folderId: undefined } : m);
      store.saveMeetings(u);
      return u;
    });
    if (activeFolder === id) setActiveFolder('all');
  };

  const moveToFolder = (meetingId: string, folderId: string) => {
    setMeetings(prev => {
      const u = prev.map(m => m.id === meetingId ? { ...m, folderId: folderId || undefined } : m);
      store.saveMeetings(u);
      return u;
    });
  };

  /* ─── Backup ─── */
  const downloadBackup = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportBackup()], { type: 'application/json' }));
    a.download = `MeetingGhost-Backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleBackupImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const stats = importBackup(await file.text());
      setMeetings(store.loadMeetings());
      setFolders(store.loadFolders());
      setSettings(store.loadSettings());
      setNotice(`Backup restored — ${stats.meetings} meetings, ${stats.folders} folders.`);
      setTimeout(() => setNotice(''), 4000);
    } catch (err: any) {
      setError(`Import failed: ${err.message}`);
    }
  };

  /* Download Models via Workers */
  const dl = (type: 'whisper' | 'gemma' | 'embed') => {
    if (type === 'whisper') {
      whisperWorkerRef.current?.postMessage({ type: 'init' });
    } else if (type === 'embed') {
      embedWorkerRef.current?.postMessage({ type: 'init' });
    } else {
      llmWorkerRef.current?.postMessage({ type: 'init' });
    }
  };

  const handleOnboarding = () => {
    setHasOnboarded(true);
    localStorage.setItem('mg_onb', '1');
    // iOS transcribes with the built-in Apple engine — no Whisper download
    if (Capacitor.getPlatform() !== 'ios') dl('whisper');
    if (hasWebGPU) dl('gemma');
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

  /* Recording — v10 segmented save-first.
     The meeting record exists from second zero; audio streams to durable
     storage in ≤60s verified segments while recording. */
  const start = async () => {
    if (recorderRef.current?.isActive) return; // no concurrent sessions
    if (transcribingIdRef.current) {
      setNotice('Transcription is running — it will continue in the background while you record.');
      setTimeout(() => setNotice(''), 4000);
    }
    if (Capacitor.isNativePlatform()) await Haptics.impact({ style: ImpactStyle.Heavy });
    setError(''); setTranscript(''); setSummary(''); setTime(0); setSavedFlash('');
    transcriptRef.current = ''; summaryRef.current = '';

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      dlogError('rec.permission.denied', e);
      setError(Capacitor.isNativePlatform()
        ? 'Microphone access denied. Open Settings → MeetingGhost → enable Microphone, then return here and try again.'
        : 'Microphone access denied. Allow microphone access for this site and try again.');
      return;
    }

    const id = Date.now().toString();
    const date = new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    currentMeetingRef.current = { id, date, dur: 0 };
    save({ id, date, dur: 0, title: 'Untitled Meeting', transcript: '', summary: '', status: 'recording', audioKind: 'segments', segments: 0, bytes: 0 });
    dlog('meeting.created', { id });

    const rec = new SegmentedRecorder(id, {
      onSegmentSaved: (info) => {
        updateMeeting(id, {
          segments: info.seg + 1,
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
    });
    recorderRef.current = rec;

    try {
      await rec.start(stream);
    } catch (e: unknown) {
      stream.getTracks().forEach(t => t.stop());
      recorderRef.current = null;
      remove(id); // nothing was recorded — drop the empty shell
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    // Visualizer (display only — independent of the recording path)
    try {
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
    timerRef.current = window.setInterval(() => setTime(t => t + 1), 1000);
    void refreshStorageInfo();
  };

  const stop = async () => {
    if (Capacitor.isNativePlatform()) await Haptics.impact({ style: ImpactStyle.Medium });
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecording(false);
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => { /* */ }); audioCtxRef.current = null; }
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    const rec = recorderRef.current;
    const m = currentMeetingRef.current;
    recorderRef.current = null;
    if (!rec || !m) return;

    setProcessing(true);
    setProcStatus('Finalizing recording…');
    // Waits for the in-flight segment AND every verified write to durable storage
    const result = await rec.stop();
    const dur = Math.round(result.recordedMs / 1000);

    if (result.segments === 0 || result.totalBytes === 0) {
      updateMeeting(m.id, { status: 'recovery_required', dur, diag: 'The microphone produced no data — nothing could be saved.' });
      setError('No audio was captured. Check that the microphone works and permissions are granted.');
      setProcessing(false);
      return;
    }

    updateMeeting(m.id, { status: 'saved', dur, segments: result.segments, bytes: result.totalBytes, mimeType: result.mimeType });
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
    save({ id, date, dur: 0, title: 'Untitled Meeting', transcript: '', summary: '', status: 'recording', audioKind: 'segments', segments: 0, bytes: 0 });
    try {
      await writeSegment(id, 0, file); // durable + verified before anything else
      updateMeeting(id, { status: 'saved', segments: 1, bytes: file.size, mimeType: file.type || 'audio/mp4' });
      setAudioIds(prev => new Set(prev).add(id));
      setSavedFlash('Audio saved — starting transcription.');
      void runTranscription(id);
    } catch (err: unknown) {
      updateMeeting(id, { status: 'recovery_required', diag: `import failed: ${err instanceof Error ? err.message : String(err)}` });
      setError(`Could not save the imported audio: ${err instanceof Error ? err.message : String(err)}`);
      setProcessing(false);
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

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const clip = async (t: string) => {
    try { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* */ }
  };

  const share = async (t: string) => {
    try {
      if (Capacitor.isNativePlatform()) { await Share.share({ title: 'MeetingGhost Transcript', text: t }); return; }
      if (navigator.share) { await navigator.share({ title: 'MeetingGhost Transcript', text: t }); return; }
    } catch { /* dismissed */ }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([t], { type: 'text/plain' }));
    a.download = `MeetingGhost-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const exportPDF = (m: MeetingRecord) => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text(m.title || "MeetingGhost Transcript", 20, 20);
    doc.setFontSize(10);
    doc.text(m.date, 20, 28);
    doc.setFontSize(14);
    doc.text("Summary", 20, 40);
    doc.setFontSize(12);
    doc.text(doc.splitTextToSize(m.summary || 'No summary.', 170), 20, 50);

    if (m.actionItems?.length) {
      doc.addPage();
      doc.setFontSize(14);
      doc.text("Action Items", 20, 20);
      doc.setFontSize(12);
      const items = m.actionItems.map(it => `[${it.done ? 'x' : ' '}] ${it.text}`).join('\n');
      doc.text(doc.splitTextToSize(items, 170), 20, 30);
    }

    doc.addPage();
    doc.setFontSize(14);
    doc.text("Transcript", 20, 20);
    doc.setFontSize(12);
    doc.text(doc.splitTextToSize(m.transcript || '', 170), 20, 30);

    doc.save(`MeetingGhost-${m.title || m.id}.pdf`);
  };

  const exportMD = (m: MeetingRecord) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([meetingToMarkdown(m)], { type: 'text/markdown' }));
    a.download = `MeetingGhost-${m.title || m.id}.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
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
      const url = await createGitHubIssue(s.githubToken, s.githubRepo, m);
      setNotice(`GitHub issue created: ${url}`);
      setTimeout(() => setNotice(''), 6000);
    } catch (e: any) {
      setError(`GitHub export failed: ${e.message}`);
    }
  };

  const downloadICS = (m: MeetingRecord) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buildFollowUpICS(m)], { type: 'text/calendar' }));
    a.download = `MeetingGhost-FollowUp-${m.id}.ics`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const emailDraft = (m: MeetingRecord) => {
    window.location.href = buildMailto(m);
  };

  const filteredMeetings = meetings.filter(m =>
    (activeFolder === 'all' || m.folderId === activeFolder) &&
    (m.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
     m.transcript?.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="app-shell">
      {!hasOnboarded && (
        <div className="onboarding-overlay">
          <div className="onboarding-modal">
            <h2>Welcome to MeetingGhost Gold</h2>
            <p>To provide 100% private, on-device intelligence without cloud subscriptions, MeetingGhost requires one-time downloads of our AI models (Whisper & TinyLlama). No audio ever leaves your device.</p>
            <button className="btn-primary" onClick={handleOnboarding}>
              <Download /> Download Required Models
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
        <nav className="nav-tabs">
          <button className={`nav-tab${tab === 'studio' ? ' active' : ''}`} onClick={() => setTab('studio')}>
            <Mic />Studio
          </button>
          <button className={`nav-tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
            <Clock />History{meetings.length > 0 && ` (${meetings.length})`}
          </button>
          <button className={`nav-tab${tab === 'ask' ? ' active' : ''}`} onClick={() => setTab('ask')}>
            <MessageSquare />Ask
          </button>
          <button className={`nav-tab${tab === 'models' ? ' active' : ''}`} onClick={() => setTab('models')}>
            <Zap />AI Models
          </button>
          <button className={`nav-tab${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>
            <SettingsIcon />Settings
          </button>
        </nav>
      </header>

      <main className="main">
        {notice && <div className="notice-banner">{notice}</div>}
        {error && tab !== 'studio' && <div className="error-banner" style={{ maxWidth: 'none' }}>{error}</div>}

        {/* ═══ HERO CARD ═══ */}
        <section className="hero">
          <div className="hero-texture" style={{ backgroundImage: `url(${goldBg})` }} />
          <div className="hero-shimmer" />
          <div className="hero-content">
            <div className="hero-eyebrow"><Sparkles />On-Device Voice Intelligence</div>
            <h2 className="hero-heading">Intuitive <em>Voice-to-Text</em> with Zero Cloud Dependency</h2>
            <p className="hero-body">Record conversations, generate instant transcripts, and export to ChatGPT, Claude, or your local AI tool — all processed entirely on your device.</p>
          </div>
          <div className="hero-aside">
            <div className="stat-card">
              <div className="stat-icon"><HardDrive /></div>
              <div>
                <div className="stat-label">Initial App Bundle</div>
                <div className="stat-value">Ultra-Light ~3 MB</div>
              </div>
            </div>
            <div className="platform-pill">
              {Capacitor.isNativePlatform()
                ? <><Smartphone />Capacitor ({Capacitor.getPlatform()})</>
                : <><Globe />PWA Web App</>
              }
            </div>
          </div>
        </section>

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
                    <button className="upload-btn" onClick={() => fileInputRef.current?.click()} title="Import Audio File">
                      <Upload />
                    </button>
                  </>
                )}
              </div>

              {recording && (
                <div className="rec-chip" style={{ margin: '0 auto 16px auto' }}>
                  <div className="rec-dot" />
                  <span className="rec-label">REC {fmt(time)}</span>
                </div>
              )}

              {recording && (
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
                <div className="processing-chip">
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
                <div className="saved-banner"><CheckCircle2 />{savedFlash}</div>
              )}
              {error && <div className="error-banner">{error}</div>}
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
                      >
                        <Highlighter />
                      </button>
                      <button className="btn-ghost" onClick={() => clip(transcript)}>
                        {copied ? <><Check />Copied</> : <><Copy />Copy</>}
                      </button>
                      <button className="btn-gold" onClick={() => share(transcript)}>
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
                  onClick={recording ? stop : start}
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
                <input type="file" accept="application/json" ref={backupInputRef} hidden onChange={handleBackupImport} />
                <button className="btn-ghost" onClick={() => backupInputRef.current?.click()} title="Import backup JSON">
                  <Upload />Import
                </button>
                <button className="btn-ghost" onClick={downloadBackup} title="Export all data as JSON">
                  <DatabaseBackup />Backup
                </button>
              </div>
            </div>

            <div className="folder-bar">
              <button className={`folder-chip${activeFolder === 'all' ? ' active' : ''}`} onClick={() => setActiveFolder('all')}>
                <FolderIcon />All ({meetings.length})
              </button>
              {folders.map(f => (
                <span key={f.id} className={`folder-chip${activeFolder === f.id ? ' active' : ''}`}>
                  <button className="folder-chip-label" onClick={() => setActiveFolder(f.id)}>
                    <FolderIcon />{f.name} ({meetings.filter(m => m.folderId === f.id).length})
                  </button>
                  <button className="folder-chip-x" onClick={() => deleteFolder(f.id)} title={`Delete folder "${f.name}"`}>
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
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            )}

            {filteredMeetings.length === 0 ? (
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
                        <strong style={{ color: 'var(--gold-200)', display: 'block', fontSize: '15px' }}>{m.title || 'Untitled Meeting'}</strong>
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
                          <span className="status-chip error">Transcription interrupted{typeof m.tNext === 'number' && m.segments ? ` at ${Math.min(m.tNext + 1, m.segments)}/${m.segments}` : ''} — resumable</span>
                        )}
                        {m.status === 'transcription_failed' && (
                          <span className="status-chip error">Transcription failed after {m.retries} tries — audio intact</span>
                        )}
                        {m.status === 'recovery_required' && (
                          <span className="status-chip error">Interrupted before audio could be saved</span>
                        )}
                        {m.status === 'complete' && !m.transcript && (
                          <span className="status-chip saved"><CheckCircle2 />Audio saved — no speech detected</span>
                        )}
                      </div>
                      <div className="history-btns">
                        {folders.length > 0 && (
                          <select
                            className="folder-select"
                            value={m.folderId || ''}
                            onChange={(e) => moveToFolder(m.id, e.target.value)}
                            title="Move to folder"
                          >
                            <option value="">No folder</option>
                            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                        )}
                        <button className="btn-sq" onClick={() => exportPDF(m)} title="Export PDF"><FileText /></button>
                        <button className="btn-sq" onClick={() => exportMD(m)} title="Export Markdown"><Download /></button>
                        <button className="btn-sq" onClick={() => exportToGitHub(m)} title="Export Action Items to GitHub Issue"><CircleDot /></button>
                        <button className="btn-sq" onClick={() => downloadICS(m)} title="Add Follow-up to Calendar (.ics)"><CalendarPlus /></button>
                        <button className="btn-sq" onClick={() => emailDraft(m)} title="Draft Email"><Mail /></button>
                        <button className="btn-sq" onClick={() => share(m.transcript)} title="Share Text"><Share2 /></button>
                        <button className="btn-sq del" onClick={() => remove(m.id)} title="Delete"><Trash2 /></button>
                      </div>
                    </div>
                    {m.transcript && <div className="history-snippet">{m.transcript}</div>}
                    {m.diag && !m.transcript && <div className="diag-line">{m.diag}</div>}
                    {!m.transcript && audioIds.has(m.id) &&
                      ['saved', 'queued', 'transcription_interrupted', 'transcription_failed', 'error'].includes(m.status || '') && (
                        <button className="btn-gold retry-btn" onClick={() => retryTranscription(m)}>
                          <RefreshCw />{typeof m.tNext === 'number' && m.tNext > 0 ? `Resume Transcription (from ${m.tNext + 1}/${m.segments})` : 'Transcribe Audio'}
                        </button>
                      )}
                    {audioIds.has(m.id) && (
                      <AudioPlayer meetingId={m.id} segments={m.audioKind === 'segments' ? (m.segments || 0) : 0} mimeType={m.mimeType || 'audio/mp4'} />
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
              Search across everything you've recorded by meaning, not just keywords —
              answered {settings.useCloud && settings.claudeKey ? 'by Claude' : 'entirely on-device'}.
            </p>

            {!embedder.done ? (
              <div className="settings-group">
                <p className="settings-hint" style={{ margin: 0 }}>
                  The Semantic Search Engine model isn't installed yet.
                </p>
                {embedder.loading ? (
                  <div className="progress-wrap" style={{ marginTop: 10 }}>
                    <div className="progress-top"><span>Downloading…</span><span>{embedder.progress}%</span></div>
                    <div className="progress-track"><div className="progress-bar" style={{ width: `${embedder.progress}%` }} /></div>
                  </div>
                ) : (
                  <button className="btn-download" style={{ marginTop: 10 }} onClick={() => dl('embed')}>
                    <Download />Download ({embedder.size})
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="ask-bar">
                  <input
                    type="text"
                    className="search-input"
                    placeholder='e.g. "What did we decide about the marketing budget?"'
                    value={askQuery}
                    onChange={e => setAskQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') ask(); }}
                  />
                  <button className="btn-gold" onClick={ask} disabled={askBusy}>
                    {askBusy ? <Loader2 className="spin" /> : <Sparkles />}Ask
                  </button>
                </div>

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
            )}
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
              Heavy AI engines are downloaded post-installation to keep your initial download ultra-small (~3 MB). Install them on-demand below.
            </p>
            <div className="models-grid">
              {nativeSTT?.available && (
                <div className="model-tile">
                  <div>
                    <div className="model-top">
                      <div className="model-name">Apple Speech (built-in)</div>
                      <div className="model-size">no download</div>
                    </div>
                    <p className="model-info">
                      Transcription runs natively on this device using
                      {nativeSTT.engine === 'SpeechAnalyzer' ? " Apple's iOS 26 SpeechAnalyzer" : ' Apple speech recognition'} —
                      100% on-device, audio never leaves your phone.
                    </p>
                  </div>
                  <div className="model-done"><CheckCircle2 />Built-in & Ready</div>
                </div>
              )}
              {([
                // On iOS the native engine replaces Whisper (the WASM path is the WebView crash source)
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
                      Requires WebGPU, which this device/browser doesn't support yet. Transcription still works — summaries will be unavailable.
                    </div>
                  ) : m.done ? (
                    <div className="model-done"><CheckCircle2 />Installed & Ready</div>
                  ) : m.loading ? (
                    <div className="progress-wrap">
                      <div className="progress-top"><span>Downloading…</span><span>{m.progress}%</span></div>
                      <div className="progress-track"><div className="progress-bar" style={{ width: `${m.progress}%` }} /></div>
                    </div>
                  ) : (
                    <button className="btn-download" onClick={() => dl(t)}>
                      <Download />Download ({m.size})
                    </button>
                  )}
                </div>
              ); })}
            </div>

            {embedder.done && meetings.length > 0 && (
              <div className="settings-group" style={{ marginTop: 16 }}>
                <label className="settings-label"><RefreshCw style={{ width: 14, height: 14 }} /> Semantic Index</label>
                <p className="settings-hint">
                  {indexedCount} of {meetings.length} meetings indexed for "Ask Your Meetings". New recordings index automatically.
                </p>
                <button className="btn-download" onClick={indexAll} disabled={indexing || indexedCount >= meetings.length}>
                  {indexing ? <Loader2 className="spin" /> : <RefreshCw />}
                  {indexing ? 'Indexing…' : 'Index All Meetings'}
                </button>
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
              <label className="settings-label">Summary Template</label>
              <p className="settings-hint">Shapes what the AI focuses on when summarizing your meetings.</p>
              <select
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
              <label className="settings-label"><KeyRound style={{ width: 14, height: 14 }} /> Claude API — Premium Summaries (optional)</label>
              <p className="settings-hint">
                By default everything runs 100% on-device. If you want MeetGeek-quality structured summaries,
                paste your own Anthropic API key. The transcript is then sent directly from your device to
                Anthropic — never through any MeetingGhost server. The key is stored only on this device and
                is excluded from backups.
              </p>
              <input
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
              <label className="settings-label"><CircleDot style={{ width: 14, height: 14 }} /> GitHub Integration (optional)</label>
              <p className="settings-hint">
                Export a meeting's action items as a GitHub issue (one issue per meeting, with a
                task-list checklist). Needs a fine-grained personal access token with Issues write
                access. The token stays on this device and is excluded from backups.
              </p>
              <input
                type="text"
                className="search-input"
                placeholder="owner/repository (e.g. acme/meeting-actions)"
                value={settings.githubRepo}
                onChange={e => setSettings(s => ({ ...s, githubRepo: e.target.value.trim() }))}
                autoComplete="off"
              />
              <input
                type="password"
                className="search-input"
                style={{ marginTop: 8 }}
                placeholder="github_pat_... or ghp_..."
                value={settings.githubToken}
                onChange={e => setSettings(s => ({ ...s, githubToken: e.target.value.trim() }))}
                autoComplete="off"
              />
            </div>

            <div className="settings-group">
              <label className="settings-label"><HardDrive style={{ width: 14, height: 14 }} /> Diagnostics</label>
              <p className="settings-hint">
                Exports a local log of app events (recording states, segment writes, storage,
                worker status, errors) for troubleshooting. It never contains your audio,
                transcripts, or meeting titles.
              </p>
              <button className="btn-download" onClick={async () => {
                const json = await exportDiagnostics(APP_VERSION);
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
                a.download = `MeetingGhost-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}.json`;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
              }}>
                <Download />Export Diagnostics
              </button>

              <div style={{ marginTop: 18 }}>
                <label className="settings-label"><RefreshCw style={{ width: 14, height: 14 }} /> Reliability Self-Test</label>
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
