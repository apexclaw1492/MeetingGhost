import { useState, useEffect, useRef } from 'react';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import {
  Mic, Square, Loader2, Sparkles, Brain, Copy, Check,
  Share2, ShieldCheck, Trash2, Clock, Smartphone, Globe,
  Download, Award, Zap, HardDrive, CheckCircle2
} from 'lucide-react';
import goldBg from './assets/gold_bg.jpg';
import { getAudioData } from './utils/audio';
import './App.css';

/* ─── Types ─── */
interface MeetingRecord {
  id: string;
  date: string;
  dur: number;
  transcript: string;
  summary: string;
}

interface Model {
  name: string;
  size: string;
  done: boolean;
  loading: boolean;
  progress: number;
}

/* ─── App ─── */
export function App() {
  const [recording, setRecording] = useState(false);
  const [time, setTime] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [summary, setSummary] = useState('');
  const [processing, setProcessing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [tab, setTab] = useState<'studio' | 'history' | 'models'>('studio');

  const [whisper, setWhisper] = useState<Model>({
    name: 'Whisper Voice-to-Text', size: '141 MB', done: false, loading: false, progress: 0
  });
  const [gemma, setGemma] = useState<Model>({
    name: 'Gemma 3 Summarizer', size: '253 MB', done: false, loading: false, progress: 0
  });

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

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
  const gemmaStateRef = useRef<Model>(gemma);

  /* Persist / restore */
  useEffect(() => {
    try {
      const h = localStorage.getItem('mg_h'); if (h) setMeetings(JSON.parse(h));
      const w = localStorage.getItem('mg_w'); if (w) { const wp = JSON.parse(w); setWhisper(wp); }
      const g = localStorage.getItem('mg_g'); if (g) { const gp = JSON.parse(g); setGemma(gp); gemmaStateRef.current = gp; }
    } catch { /* noop */ }
    
    // Initialize Web Workers
    whisperWorkerRef.current = new Worker(new URL('./workers/whisper.worker.ts', import.meta.url), { type: 'module' });
    llmWorkerRef.current = new Worker(new URL('./workers/llm.worker.ts', import.meta.url), { type: 'module' });

    whisperWorkerRef.current.onmessage = (e) => {
      const { status, progress, text, message } = e.data;
      if (status === 'progress') {
        setWhisper(prev => ({ ...prev, loading: true, progress }));
      } else if (status === 'ready') {
        setWhisper(prev => {
          const next = { ...prev, loading: false, done: true, progress: 100 };
          localStorage.setItem('mg_w', JSON.stringify(next));
          return next;
        });
      } else if (status === 'complete') {
        setTranscript(text);
        if (llmWorkerRef.current && gemmaStateRef.current.done) {
          llmWorkerRef.current.postMessage({ type: 'summarize', text });
        } else {
          setProcessing(false);
          const m = currentMeetingRef.current;
          if (m) save({ id: m.id, date: m.date, dur: m.dur, transcript: text, summary: '' });
        }
      } else if (status === 'error') {
        setError(`Transcription Error: ${message}`);
        setProcessing(false);
      }
    };

    llmWorkerRef.current.onmessage = (e) => {
      const { status, progress, text, message } = e.data;
      if (status === 'progress') {
        setGemma(prev => ({ ...prev, loading: true, progress }));
      } else if (status === 'ready') {
        setGemma(prev => {
          const next = { ...prev, loading: false, done: true, progress: 100 };
          gemmaStateRef.current = next;
          localStorage.setItem('mg_g', JSON.stringify(next));
          return next;
        });
      } else if (status === 'complete') {
        setSummary(text);
        setProcessing(false);
        const m = currentMeetingRef.current;
        setTranscript(prevText => {
          if (m) save({ id: m.id, date: m.date, dur: m.dur, transcript: prevText, summary: text });
          return prevText;
        });
      } else if (status === 'error') {
        setError(`Summarization Error: ${message}. Device might not support WebGPU.`);
        setProcessing(false);
        const m = currentMeetingRef.current;
        setTranscript(prevText => {
          if (m) save({ id: m.id, date: m.date, dur: m.dur, transcript: prevText, summary: '' });
          return prevText;
        });
      }
    };

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

  const remove = (id: string) => {
    setMeetings(prev => {
      const u = prev.filter(m => m.id !== id);
      localStorage.setItem('mg_h', JSON.stringify(u));
      return u;
    });
  };

  /* Download Models via Workers */
  const dl = (type: 'whisper' | 'gemma') => {
    if (type === 'whisper') {
      whisperWorkerRef.current?.postMessage({ type: 'init' });
    } else {
      llmWorkerRef.current?.postMessage({ type: 'init' });
    }
  };

  /* Audio Visualizer Loop */
  const drawWaveform = () => {
    if (!analyserRef.current || !dataArrayRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    analyserRef.current.getByteFrequencyData(dataArrayRef.current as any);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const barWidth = 4;
    const gap = 3;
    const bars = Math.floor(canvas.width / (barWidth + gap));
    
    const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
    gradient.addColorStop(0, '#a17a26');
    gradient.addColorStop(0.5, '#d4af37');
    gradient.addColorStop(1, '#fef3c7');

    for (let i = 0; i < bars; i++) {
      const percent = dataArrayRef.current[i * 2] / 255;
      const height = Math.max(4, percent * canvas.height);
      const x = i * (barWidth + gap);
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, (canvas.height / 2) - (height / 2), barWidth, height, 2);
      ctx.fill();
    }
    animFrameRef.current = requestAnimationFrame(drawWaveform);
  };

  /* Recording */
  const start = async () => {
    if (Capacitor.isNativePlatform()) await Haptics.impact({ style: ImpactStyle.Heavy });
    setError(''); setTranscript(''); setSummary(''); setTime(0); chunksRef.current = [];
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
      if (!whisper.done) {
        throw new Error("Whisper model is not installed. Go to AI Models tab to download it first.");
      }
      const audioFloat32 = await getAudioData(chunksRef.current, 16000);
      whisperWorkerRef.current?.postMessage({ type: 'transcribe', audio: audioFloat32 });
    } catch (e: any) { 
      setError(`Processing error: ${e.message}`); 
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

  return (
    <div className="app-shell">
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
            {/* Voice Recorder */}
            <div className={`panel voice-panel${recording ? ' is-recording' : ''}`}>
              <div className="mic-orbit">
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

              {recording && (
                <div className="rec-chip">
                  <div className="rec-dot" />
                  <span className="rec-label">REC {fmt(time)}</span>
                </div>
              )}

              {recording && (
                <div className="waveform">
                  <canvas ref={canvasRef} width={200} height={44} style={{ width: '100%', height: '44px' }} />
                </div>
              )}

              <p className="voice-hint">
                {recording ? 'Recording live audio…' : 'Tap the golden mic to start recording'}
              </p>

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
                    ? <div className="mono-block">{transcript}</div>
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
          </div>
        )}

        {/* ═══ HISTORY TAB ═══ */}
        {tab === 'history' && (
          <section className="panel history-panel">
            <div className="section-heading">
              <Clock />
              <span className="gold-text">Saved Meetings ({meetings.length})</span>
            </div>
            {meetings.length === 0 ? (
              <div className="history-empty">
                <div className="history-empty-icon"><Clock /></div>
                <p>No saved meetings yet. Start a recording to save transcripts.</p>
              </div>
            ) : (
              <div className="history-stack">
                {meetings.map(m => (
                  <div key={m.id} className="history-row">
                    <div className="history-row-top">
                      <div className="history-meta">
                        <span className="history-date">{m.date}</span>
                        <span className="history-dur">Duration: {fmt(m.dur)}</span>
                      </div>
                      <div className="history-btns">
                        <button className="btn-sq" onClick={() => share(m.transcript)}><Share2 /></button>
                        <button className="btn-sq del" onClick={() => remove(m.id)}><Trash2 /></button>
                      </div>
                    </div>
                    <div className="history-snippet">{m.transcript}</div>
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
              ]).map(({ m, t, d }) => (
                <div key={t} className="model-tile">
                  <div>
                    <div className="model-top">
                      <div className="model-name">{m.name}</div>
                      <div className="model-size">{m.size}</div>
                    </div>
                    <p className="model-info">{d}</p>
                  </div>
                  {m.done ? (
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
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
