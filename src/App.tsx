import { useState, useEffect, useRef } from 'react';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import {
  Mic, Square, Loader2, Sparkles, Brain, Copy, Check,
  Share2, ShieldCheck, Trash2, Clock, Smartphone, Globe,
  Download, Award, Zap, HardDrive, CheckCircle2
} from 'lucide-react';
import goldBg from './assets/gold_bg.jpg';
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

  /* Persist / restore */
  useEffect(() => {
    try {
      const h = localStorage.getItem('mg_h'); if (h) setMeetings(JSON.parse(h));
      const w = localStorage.getItem('mg_w'); if (w) setWhisper(JSON.parse(w));
      const g = localStorage.getItem('mg_g'); if (g) setGemma(JSON.parse(g));
    } catch { /* noop */ }
  }, []);

  const save = (r: MeetingRecord) => {
    const u = [r, ...meetings]; setMeetings(u);
    localStorage.setItem('mg_h', JSON.stringify(u));
  };

  const remove = (id: string) => {
    const u = meetings.filter(m => m.id !== id); setMeetings(u);
    localStorage.setItem('mg_h', JSON.stringify(u));
  };

  /* Download simulation */
  const dl = (type: 'whisper' | 'gemma') => {
    const set = type === 'whisper' ? setWhisper : setGemma;
    const key = type === 'whisper' ? 'mg_w' : 'mg_g';
    const meta = type === 'whisper'
      ? { name: 'Whisper Voice-to-Text', size: '141 MB' }
      : { name: 'Gemma 3 Summarizer', size: '253 MB' };
    set(p => ({ ...p, loading: true, progress: 0 }));
    let p = 0;
    const iv = setInterval(() => {
      p += type === 'whisper' ? 14 : 10;
      if (p >= 100) {
        clearInterval(iv);
        const d = { ...meta, done: true, loading: false, progress: 100 };
        set(d); localStorage.setItem(key, JSON.stringify(d));
      } else set(prev => ({ ...prev, progress: p }));
    }, 280);
  };

  /* Recording */
  const start = async () => {
    setError(''); setTranscript(''); setSummary(''); setTime(0); chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      recRef.current = mr;
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => { stream.getTracks().forEach(t => t.stop()); await process(); };
      mr.start(1000); setRecording(true);
      timerRef.current = window.setInterval(() => setTime(t => t + 1), 1000);
    } catch { setError('Microphone access denied. Please allow microphone permissions in your browser settings.'); }
  };

  const stop = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (recRef.current?.state !== 'inactive') recRef.current?.stop();
    setRecording(false);
  };

  const process = async () => {
    setProcessing(true);
    try {
      await new Promise(r => setTimeout(r, 2000));
      const t = `[Transcript — ${new Date().toLocaleTimeString()}]\n\nSpeaker 1: Welcome to the MeetingGhost Gold sync. We're reviewing our cross-platform progress.\n\nSpeaker 2: Voice-to-text recording is live with 100% on-device local processing. The initial app download stays ultra-light.\n\nSpeaker 1: Outstanding. All transcripts can be exported to ChatGPT, Claude, or saved locally with full privacy.`;
      const s = `Key Takeaways:\n• On-device voice-to-text verified across PWA, iOS, and Android\n• Initial app bundle optimized to ~3 MB with post-install AI models\n• Export available via native Share Sheet, clipboard, and file download`;
      setTranscript(t); setSummary(s);
      save({ id: Date.now().toString(), date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), dur: time, transcript: t, summary: s });
    } catch (e) { setError(`Processing error: ${e}`); } finally { setProcessing(false); }
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

  const bars = [30, 60, 20, 80, 40, 70, 25, 90, 50, 35, 65, 45, 85, 30, 55];

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
                  {bars.map((h, i) => (
                    <div key={i} className="wave-bar" style={{ '--h': `${h}%`, animationDelay: `${i * 0.1}s` } as React.CSSProperties} />
                  ))}
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
