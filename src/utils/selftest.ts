/* On-device reliability self-test (v10.1).

   Runs the core record→save→transcribe matrix ON THE PHONE with a synthesized
   audio stream (no microphone permission required — the pipeline from
   MediaStream onward is identical to a real recording; only the source
   differs). State is persisted after every step, so a force-quit mid-run is
   itself a test: on relaunch the harness resumes and records the recovery.

   Results are written to Documents/selftest-results.json (test metrics only,
   never audio or transcripts) and summarized in Settings → Diagnostics. */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { log } from './diag';

export interface CycleResult {
  cycle: number;
  saved: boolean;          // segments>0 && bytes>0 verified in durable storage
  transcribed: boolean;    // reached status 'complete'
  status: string;
  segments?: number;
  bytes?: number;
  dur?: number;
  ms: number;              // wall time for the cycle
  resumedAfterKill?: boolean;
}

export interface SelfTestState {
  running: boolean;
  cycle: number;           // next cycle to run (1-based)
  total: number;
  recordSecs: number;
  results: CycleResult[];
  startedAt: string;
  kills: number;           // relaunches detected while running
  activeMeetingId?: string; // meeting of the in-flight cycle (for kill recovery)
  ladder?: number[];       // per-cycle recording seconds (duration-ladder mode)
  finishedAt?: string;
}

const KEY = 'mg_selftest';

export function loadSelfTest(): SelfTestState | null {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

export function saveSelfTest(s: SelfTestState | null) {
  if (s === null) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(s));
}

export function newSelfTest(total = 25, recordSecs = 20, startedAt = new Date().toISOString(), ladder?: number[]): SelfTestState {
  return {
    running: true, cycle: 1,
    total: ladder?.length || total,
    recordSecs, results: [], startedAt, kills: 0,
    ...(ladder?.length ? { ladder } : {}),
  };
}

/* A silent-ish synthesized stream: low-volume tone so MediaRecorder always has
   signal to encode. No permissions involved. */
export function makeTestStream(): { stream: MediaStream; dispose: () => void } {
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0.05;
  const dest = ctx.createMediaStreamDestination();
  osc.frequency.value = 330;
  osc.connect(gain); gain.connect(dest);
  osc.start();
  return {
    stream: dest.stream,
    dispose: () => { try { osc.stop(); ctx.close(); } catch { /* */ } },
  };
}

/* Persist results where they can be exported/read without touching meeting
   content. Web fallback: localStorage only. */
export async function writeResultsFile(state: SelfTestState): Promise<void> {
  const payload = JSON.stringify({
    _meetingghost_selftest: 1,
    platform: Capacitor.getPlatform(),
    ...state,
  }, null, 2);
  if (Capacitor.isNativePlatform()) {
    try {
      await Filesystem.writeFile({
        path: 'selftest-results.json', data: btoa(payload),
        directory: Directory.Data, recursive: true,
      });
    } catch { /* results still in localStorage + diagnostics */ }
  }
  log('selftest.results.written', { cycle: state.cycle - 1, total: state.total });
}

export function summarize(state: SelfTestState) {
  const saved = state.results.filter(r => r.saved).length;
  const transcribed = state.results.filter(r => r.transcribed).length;
  return {
    done: state.results.length,
    total: state.total,
    saved,
    transcribed,
    kills: state.kills,
    savedPass: saved === state.results.length && state.results.length === state.total,
    transcribePass: transcribed >= state.total - 1,
  };
}
