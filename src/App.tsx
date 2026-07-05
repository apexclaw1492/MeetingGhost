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
  KeyRound, ListChecks
} from 'lucide-react';
import jsPDF from 'jspdf';
import goldBg from './assets/gold_bg.jpg';
import { getAudioData } from './utils/audio';
import { store, exportBackup, importBackup } from './utils/store';
import type { MeetingRecord, Folder, Settings } from './utils/store';
import { highlightKeywords } from './utils/highlight';
import { TEMPLATES, localSummaryPrompt, parseActionItems, summarizeWithClaude } from './utils/intelligence';
import type { TemplateKey } from './utils/intelligence';
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
  const [tab, setTab] = useState<'studio' | 'history' | 'models' | 'settings'>('studio');
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
    try {
      if (!localStorage.getItem('mg_onb')) {
        setHasOnboarded(false);
      }
      const h = localStorage.getItem('mg_h'); if (h) setMeetings(JSON.parse(h));
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
    } catch { /* noop */ }

    // Initialize Web Workers
    whisperWorkerRef.current = new Worker(new URL('./workers/whisper.worker.ts', import.meta.url), { type: 'module' });
    llmWorkerRef.current = new Worker(new URL('./workers/llm.worker.ts', import.meta.url), { type: 'module' });

    whisperWorkerRef.current.onmessage = (e) => {
      const { status, progress, text, message } = e.data;
      if (status === 'progress') {
        // Don't flip an installed model back to "Downloading…" during silent re-warm
        setWhisper(prev => prev.done ? prev : { ...prev, loading: true, progress });
      } else if (status === 'ready') {
        setWhisper(prev => {
          const next = { ...prev, loading: false, done: true, progress: 100 };
          localStorage.setItem('mg_w', JSON.stringify(next));
          return next;
        });
      } else if (status === 'complete') {
        setTranscript(text);
        transcriptRef.current = text;
        if (!text || !text.trim() || text.trim() === '[BLANK_AUDIO]') {
          setError('No speech detected in the audio.');
          setProcessing(false);
        } else {
          runSummarization(text);
        }
      } else if (status === 'error') {
        setError(`Transcription Error: ${message}`);
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
        // Now ask for title
        llmWorkerRef.current?.postMessage({ type: 'autoTitle', text });
      } else if (status === 'title_complete') {
        setProcessing(false);
        const m = currentMeetingRef.current;
        if (m) save({
          id: m.id, date: m.date, dur: m.dur, title: text,
          transcript: transcriptRef.current, summary: summaryRef.current,
          actionItems: parseActionItems(summaryRef.current),
        });
      } else if (status === 'error') {
        setError(`Summarization Error: ${message}. Device might not support WebGPU.`);
        setProcessing(false);
        const m = currentMeetingRef.current;
        if (m && transcriptRef.current) save({ id: m.id, date: m.date, dur: m.dur, title: 'Untitled Meeting', transcript: transcriptRef.current, summary: '' });
      }
    };

    // Models persisted as installed are cached by the browser — re-warm the
    // workers so transcription/summarization actually work after a reload.
    if (whisperWasDone) whisperWorkerRef.current.postMessage({ type: 'init' });
    if (gemmaWasDone && hasWebGPU) llmWorkerRef.current.postMessage({ type: 'init' });

    return () => {
      whisperWorkerRef.current?.terminate();
      llmWorkerRef.current?.terminate();
    };
  }, []);

  const save = (r: MeetingRecord) => {
    setMeetings(prev => {
      const u = [r, ...prev];
      localStorage.setItem('mg_h', JSON.stringify(u));
      return u;
    });
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
          if (m) save({ id: m.id, date: m.date, dur: m.dur, title: r.title, transcript: text, summary: r.summary, actionItems: r.actionItems });
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
    const m = currentMeetingRef.current;
    if (llmWorkerRef.current && gemmaStateRef.current.done) {
      llmWorkerRef.current.postMessage({
        type: 'summarize', text,
        systemPrompt: localSummaryPrompt(settingsRef.current.template as TemplateKey),
      });
    } else {
      setProcessing(false);
      if (m) save({ id: m.id, date: m.date, dur: m.dur, title: 'Untitled Meeting', transcript: text, summary: '' });
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
  const dl = (type: 'whisper' | 'gemma') => {
    if (type === 'whisper') {
      whisperWorkerRef.current?.postMessage({ type: 'init' });
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
        await process(); 
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
    } catch { setError('Microphone access denied. Please allow microphone permissions in your browser settings.'); }
  };

  const stop = async () => {
    if (Capacitor.isNativePlatform()) await Haptics.impact({ style: ImpactStyle.Medium });
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    currentMeetingRef.current = {
      id: Date.now().toString(),
      date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      dur: time
    };
    if (recRef.current?.state !== 'inactive') recRef.current?.stop();
    setRecording(false);
  };

  const process = async () => {
    setProcessing(true);
    try {
      // Read via ref — this runs from MediaRecorder.onstop, whose closure may hold stale state
      if (!whisperStateRef.current.done) {
        throw new Error("Whisper model is not installed. Go to AI Models tab to download it first.");
      }
      const audioFloat32 = await getAudioData(chunksRef.current, 16000);
      whisperWorkerRef.current?.postMessage({ type: 'transcribe', audio: audioFloat32 });
    } catch (e: any) { 
      setError(`Processing error: ${e.message}`); 
      setProcessing(false); 
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(''); setTranscript(''); setSummary(''); setTime(0);
    transcriptRef.current = ''; summaryRef.current = '';

    currentMeetingRef.current = {
      id: Date.now().toString(),
      date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      dur: 0
    };
    
    setProcessing(true);
    try {
      if (!whisperStateRef.current.done) {
        throw new Error("Whisper model is not installed. Go to AI Models tab to download it first.");
      }
      const audioFloat32 = await getAudioData([file], 16000);
      whisperWorkerRef.current?.postMessage({ type: 'transcribe', audio: audioFloat32 });
    } catch (err: any) {
      setError(`Upload processing error: ${err.message}`);
      setProcessing(false);
    }
  };

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

  const exportPDF = (title: string, t: string, s: string) => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text(title || "MeetingGhost Transcript", 20, 20);
    doc.setFontSize(14);
    doc.text("Summary", 20, 35);
    doc.setFontSize(12);
    const splitSum = doc.splitTextToSize(s || '', 170);
    doc.text(splitSum, 20, 45);
    
    doc.addPage();
    doc.setFontSize(14);
    doc.text("Transcript", 20, 20);
    doc.setFontSize(12);
    const splitText = doc.splitTextToSize(t || '', 170);
    doc.text(splitText, 20, 30);
    
    doc.save(`MeetingGhost-${title || Date.now()}.pdf`);
  };

  const exportMD = (title: string, t: string, s: string) => {
    const md = `# ${title || 'MeetingGhost Transcript'}\n\n## Summary\n${s || ''}\n\n## Transcript\n${t || ''}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `MeetingGhost-${title || Date.now()}.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
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
          <button className={`nav-tab${tab === 'models' ? ' active' : ''}`} onClick={() => setTab('models')}>
            <Zap />AI Models
          </button>
          <button className={`nav-tab${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>
            <SettingsIcon />Settings
          </button>
        </nav>
      </header>

      <main className="main">
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
                  <span>Processing on-device…</span>
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

            {notice && <div className="notice-banner">{notice}</div>}
            {error && tab === 'history' && <div className="error-banner">{error}</div>}

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
                        <button className="btn-sq" onClick={() => exportPDF(m.title, m.transcript, m.summary)} title="Export PDF"><FileText /></button>
                        <button className="btn-sq" onClick={() => exportMD(m.title, m.transcript, m.summary)} title="Export Markdown"><Download /></button>
                        <button className="btn-sq" onClick={() => share(m.transcript)} title="Share Text"><Share2 /></button>
                        <button className="btn-sq del" onClick={() => remove(m.id)} title="Delete"><Trash2 /></button>
                      </div>
                    </div>
                    <div className="history-snippet">{m.transcript}</div>
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
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
