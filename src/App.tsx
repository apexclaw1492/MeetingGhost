import { useState, useEffect, useRef } from 'react';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
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
import './App.css';

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

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
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
  const lastDurRef = useRef(0);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  useEffect(() => { embedderStateRef.current = embedder; }, [embedder]);

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
    try {
      if (!localStorage.getItem('mg_onb')) {
        setHasOnboarded(false);
      }
      const h = localStorage.getItem('mg_h');
      if (h) {
        // Meetings that were mid-transcription when the app was killed (iOS
        // suspends/kills the WebView freely) become retryable, not lost.
        const loaded: MeetingRecord[] = JSON.parse(h).map((m: MeetingRecord) =>
          m.status === 'processing' ? { ...m, status: 'error' as const } : m
        );
        localStorage.setItem('mg_h', JSON.stringify(loaded));
        setMeetings(loaded);
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
        setProcStatus(`Transcribing… ${Math.round((current / total) * 100)}%`);
      } else if (status === 'complete') {
        setTranscript(text);
        transcriptRef.current = text;
        const m = currentMeetingRef.current;
        if (!text || !text.trim() || text.trim() === '[BLANK_AUDIO]') {
          setError('No speech detected in the audio. The recording is saved in History.');
          if (m) updateMeeting(m.id, { status: 'done' });
          setProcessing(false);
        } else {
          // The critical asset: persist the transcript the moment it exists.
          // Summary and title stream in afterwards as updates to the same record.
          if (m) {
            updateMeeting(m.id, { transcript: text, status: 'done' });
            indexMeeting({ id: m.id, transcript: text } as MeetingRecord).catch(() => { /* embedder optional */ });
          }
          setProcStatus('Summarizing…');
          runSummarization(text);
        }
      } else if (status === 'error') {
        const m = currentMeetingRef.current;
        if (m) updateMeeting(m.id, { status: 'error' });
        setError(`Transcription failed: ${message}. Your recording is saved in History — tap Retry there.`);
        setProcessing(false);
      }
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
    if (whisperWasDone) whisperWorkerRef.current.postMessage({ type: 'init' });
    if (gemmaWasDone && hasWebGPU) llmWorkerRef.current.postMessage({ type: 'init' });
    if (embedderWasDone) embedWorkerRef.current.postMessage({ type: 'init' });

    indexedMeetingIds().then(ids => setIndexedCount(ids.size)).catch(() => { /* noop */ });
    idb.keys('audio').then(keys => setAudioIds(new Set(keys.map(String)))).catch(() => { /* noop */ });

    return () => {
      whisperWorkerRef.current?.terminate();
      llmWorkerRef.current?.terminate();
      embedWorkerRef.current?.terminate();
    };
  }, []);

  const save = (r: MeetingRecord) => {
    setMeetings(prev => {
      const u = [r, ...prev];
      localStorage.setItem('mg_h', JSON.stringify(u));
      return u;
    });
  };

  const updateMeeting = (id: string, patch: Partial<MeetingRecord>) => {
    setMeetings(prev => {
      const u = prev.map(m => m.id === id ? { ...m, ...patch } : m);
      localStorage.setItem('mg_h', JSON.stringify(u));
      return u;
    });
  };

  /* ─── Save-first pipeline ───
     The recording is persisted (record + audio blob) BEFORE any decoding or
     AI work begins, so an iOS WebView suspension/kill can never lose it. */
  const beginMeeting = async (audio: Blob, dur: number) => {
    setProcessing(true);
    setProcStatus('Saving recording…');
    setError('');
    const id = Date.now().toString();
    const date = new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    currentMeetingRef.current = { id, date, dur };
    save({ id, date, dur, title: 'Untitled Meeting', transcript: '', summary: '', status: 'processing' });
    try {
      await idb.put('audio', id, audio);
      setAudioIds(prev => new Set(prev).add(id));
    } catch { /* storage full — record still saved, just without replay/retry audio */ }
    await transcribeMeeting(id, audio, dur);
  };

  const transcribeMeeting = async (id: string, audio: Blob, dur: number) => {
    setProcessing(true);
    try {
      if (!whisperStateRef.current.done) {
        throw new Error('Whisper model is not installed — download it in the AI Models tab');
      }
      setProcStatus('Preparing audio…');
      const audioFloat32 = await getAudioData([audio], 16000);
      // Uploads (and any timer glitch) get their true duration from the audio itself
      const secs = Math.round(audioFloat32.length / 16000);
      if (!dur && secs) updateMeeting(id, { dur: secs });
      setProcStatus('Transcribing…');
      whisperWorkerRef.current?.postMessage({ type: 'transcribe', audio: audioFloat32 });
    } catch (e: unknown) {
      updateMeeting(id, { status: 'error' });
      setError(`Processing error: ${e instanceof Error ? e.message : String(e)}. Your recording is saved in History — tap Retry there.`);
      setProcessing(false);
    }
  };

  const retryTranscription = async (m: MeetingRecord) => {
    if (processing) {
      setNotice('Another transcription is already running — try again when it finishes.');
      setTimeout(() => setNotice(''), 4000);
      return;
    }
    const blob = await idb.get<Blob>('audio', m.id).catch(() => null);
    if (!blob) {
      setError('No stored audio found for this meeting.');
      return;
    }
    currentMeetingRef.current = { id: m.id, date: m.date, dur: m.dur };
    updateMeeting(m.id, { status: 'processing' });
    await transcribeMeeting(m.id, blob, m.dur);
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
    idb.del('audio', id)
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
    dl('whisper');
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

  /* Recording */
  const start = async () => {
    if (Capacitor.isNativePlatform()) await Haptics.impact({ style: ImpactStyle.Heavy });
    setError(''); setTranscript(''); setSummary(''); setTime(0); chunksRef.current = [];
    transcriptRef.current = ''; summaryRef.current = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      recRef.current = mr;
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (audioCtxRef.current) audioCtxRef.current.close();
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (chunksRef.current.length === 0) {
          setError('No audio was captured — please check microphone permission and try again.');
          return;
        }
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0].type || 'audio/mp4' });
        await beginMeeting(blob, lastDurRef.current);
      };

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);

      mr.start(1000); setRecording(true);
      timerRef.current = window.setInterval(() => setTime(t => t + 1), 1000);
      drawWaveform();
    } catch { setError('Microphone access denied. Enable the microphone for MeetingGhost in your device Settings.'); }
  };

  const stop = async () => {
    if (Capacitor.isNativePlatform()) await Haptics.impact({ style: ImpactStyle.Medium });
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    lastDurRef.current = time; // onstop fires from a stale closure — pass duration via ref
    if (recRef.current?.state !== 'inactive') recRef.current?.stop();
    setRecording(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(''); setTranscript(''); setSummary(''); setTime(0);
    transcriptRef.current = ''; summaryRef.current = '';
    await beginMeeting(file, 0);
    e.target.value = ''; // allow re-uploading the same file
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

              {processing && (
                <div className="processing-chip">
                  <Loader2 className="spin" />
                  <span>{procStatus || 'Processing on-device…'}</span>
                </div>
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
                        {m.status === 'processing' && (
                          <span className="status-chip processing"><Loader2 className="spin" />{procStatus || 'Transcribing…'}</span>
                        )}
                        {m.status === 'error' && (
                          <span className="status-chip error">Transcription interrupted</span>
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
                    {m.transcript
                      ? <div className="history-snippet">{m.transcript}</div>
                      : m.status === 'error' && audioIds.has(m.id) && (
                          <button className="btn-gold retry-btn" onClick={() => retryTranscription(m)}>
                            <RefreshCw />Retry Transcription
                          </button>
                        )}
                    {audioIds.has(m.id) && <AudioPlayer meetingId={m.id} />}
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
              {([
                { m: whisper, t: 'whisper' as const, d: 'Provides 100% private, offline speech-to-text transcription directly on your device.' },
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
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
