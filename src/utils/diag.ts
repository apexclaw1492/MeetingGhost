/* Local diagnostics: a persistent ring buffer of app events (no meeting
   content — titles/transcripts/audio are never logged). Exportable from
   Settings so failed sessions on a phone can be investigated. */

import { Capacitor } from '@capacitor/core';

const KEY = 'mg_diag';
const MAX_EVENTS = 600;

export interface DiagEvent {
  t: string;          // ISO timestamp
  ev: string;         // event name, e.g. 'rec.segment.written'
  d?: Record<string, unknown>; // sanitized details (numbers, flags, codes)
}

let buffer: DiagEvent[] | null = null;

function load(): DiagEvent[] {
  if (buffer) return buffer;
  try { buffer = JSON.parse(localStorage.getItem(KEY) || '[]'); }
  catch { buffer = []; }
  return buffer!;
}

let persistTimer: number | null = null;
function persistSoon() {
  // Batch writes — log() can be called several times per second while recording
  if (persistTimer !== null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    try { localStorage.setItem(KEY, JSON.stringify(buffer)); } catch { /* full */ }
  }, 400);
}

export function log(ev: string, d?: Record<string, unknown>) {
  const b = load();
  b.push({ t: new Date().toISOString(), ev, ...(d ? { d } : {}) });
  if (b.length > MAX_EVENTS) b.splice(0, b.length - MAX_EVENTS);
  persistSoon();
}

/* Errors: keep the message (sanitized to 200 chars), never a payload */
export function logError(ev: string, e: unknown, extra?: Record<string, unknown>) {
  const msg = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 200);
  log(ev, { ...extra, error: msg });
}

export async function exportDiagnostics(appVersion: string): Promise<string> {
  let device: Record<string, unknown> = { platform: Capacitor.getPlatform() };
  try {
    const { Device } = await import('@capacitor/device');
    const info = await Device.getInfo();
    device = {
      platform: info.platform, model: info.model, osVersion: info.osVersion,
      memUsed: info.memUsed, webViewVersion: info.webViewVersion,
    };
  } catch { /* web or plugin unavailable */ }
  try {
    const { freeBytes } = await import('./audioStore');
    device.freeBytes = await freeBytes();
  } catch { /* unknown */ }

  return JSON.stringify({
    _meetingghost_diagnostics: 1,
    exportedAt: new Date().toISOString(),
    appVersion,
    device,
    // meeting metadata only: ids/states/sizes, never titles or content
    meetings: (() => {
      try {
        return JSON.parse(localStorage.getItem('mg_h') || '[]').map((m: Record<string, unknown>) => ({
          id: m.id, status: m.status, dur: m.dur, bytes: m.bytes,
          segments: m.segments, retries: m.retries, lastError: m.diag,
          hasTranscript: !!(m.transcript as string)?.length,
        }));
      } catch { return []; }
    })(),
    events: load(),
  }, null, 2);
}
