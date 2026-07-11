/* Central localStorage-backed store for MeetingGhost.
   Keys: mg_h (meetings), mg_f (folders), mg_settings (preferences),
   mg_w / mg_g (model states), mg_onb (onboarding flag). */

export interface ActionItem {
  text: string;
  done: boolean;
}

/* Persistent recording/processing state machine (v10). Every transition is
   written to localStorage so the app reconstructs correct state after a
   crash, force-quit, WebView reload, or device restart.
   Legacy v9 values ('processing'/'done'/'error') are normalized on load. */
export type MeetingStatus =
  | 'recording'                  // segments streaming to durable storage
  | 'saved'                      // audio finalized+verified; not yet transcribed
  | 'queued'                     // waiting for transcription to start
  | 'transcribing'               // per-segment transcription in flight
  | 'transcription_interrupted'  // resumable from checkpoint (tNext)
  | 'transcription_failed'       // retries exhausted; audio intact
  | 'complete'                   // transcript done (summary/title may still stream in)
  | 'recovery_required'          // crashed before any audio segment was flushed
  | 'processing' | 'done' | 'error'; // legacy v9

export interface MeetingRecord {
  id: string;
  date: string;
  dur: number;                 // seconds, from recorded audio (not UI time)
  title: string;
  transcript: string;
  summary: string;
  folderId?: string;
  actionItems?: ActionItem[];
  status?: MeetingStatus;
  segments?: number;           // verified segment count on disk
  bytes?: number;              // verified audio bytes on disk
  mimeType?: string;           // segment container type
  audioKind?: 'segments' | 'single'; // 'single' = legacy v9 blob / uploaded file
  tNext?: number;              // transcription checkpoint: next segment index
  tParts?: string[];           // per-segment transcripts until assembly
  retries?: number;
  recovered?: boolean;         // surfaced after crash recovery
  diag?: string;               // last sanitized error for this meeting
}

export interface Folder {
  id: string;
  name: string;
}

export interface Settings {
  vizTheme: 'bars' | 'wave' | 'circle';
  highlightKeywords: boolean;
  template: 'general' | 'standup' | 'sales' | 'interview';
  claudeKey: string;
  useCloud: boolean;
  githubToken: string;
  githubRepo: string;
}

const DEFAULT_SETTINGS: Settings = {
  vizTheme: 'bars',
  highlightKeywords: false,
  template: 'general',
  claudeKey: '',
  useCloud: false,
  githubToken: '',
  githubRepo: '',
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch { return fallback; }
}

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export const store = {
  loadMeetings: (): MeetingRecord[] => readArray<MeetingRecord>('mg_h'),
  saveMeetings: (m: MeetingRecord[]) => localStorage.setItem('mg_h', JSON.stringify(m)),

  loadFolders: (): Folder[] => readArray<Folder>('mg_f'),
  saveFolders: (f: Folder[]) => localStorage.setItem('mg_f', JSON.stringify(f)),

  loadSettings: (): Settings => read<Settings>('mg_settings', DEFAULT_SETTINGS),
  saveSettings: (s: Settings) => localStorage.setItem('mg_settings', JSON.stringify(s)),
};

/* ─── Full-database backup / restore ─── */

const BACKUP_KEYS = ['mg_h', 'mg_f', 'mg_settings', 'mg_w', 'mg_g', 'mg_onb'];

export function exportBackup(): string {
  const data: Record<string, unknown> = { _meetingghost: 1, exportedAt: new Date().toISOString() };
  for (const k of BACKUP_KEYS) {
    const v = localStorage.getItem(k);
    if (v !== null) { try { data[k] = JSON.parse(v); } catch { data[k] = v; } }
  }
  // Never write the user's API keys/tokens into a shareable backup file
  if (data.mg_settings && typeof data.mg_settings === 'object') {
    delete (data.mg_settings as Record<string, unknown>).claudeKey;
    delete (data.mg_settings as Record<string, unknown>).githubToken;
  }
  return JSON.stringify(data, null, 2);
}

/* Merge-imports meetings and folders (by id, existing wins); replaces settings. */
export function importBackup(json: string): { meetings: number; folders: number } {
  const data = JSON.parse(json);
  if (!data || data._meetingghost !== 1) throw new Error('Not a MeetingGhost backup file.');

  const mergeById = <T extends { id: string }>(current: T[], incoming: unknown): T[] => {
    if (!Array.isArray(incoming)) return current;
    const have = new Set(current.map(x => x.id));
    return [...current, ...(incoming as T[]).filter(x => x && x.id && !have.has(x.id))];
  };

  const meetings = mergeById(store.loadMeetings(), data.mg_h);
  const folders = mergeById(store.loadFolders(), data.mg_f);
  store.saveMeetings(meetings);
  store.saveFolders(folders);
  if (data.mg_settings) store.saveSettings({ ...store.loadSettings(), ...data.mg_settings });

  return { meetings: meetings.length, folders: folders.length };
}
