/* Central localStorage-backed store for MeetingGhost.
   Keys: mg_h (meetings), mg_f (folders), mg_settings (preferences),
   mg_w / mg_g (model states), mg_onb (onboarding flag). */

export interface ActionItem {
  text: string;
  done: boolean;
}

export interface MeetingRecord {
  id: string;
  date: string;
  dur: number;
  title: string;
  transcript: string;
  summary: string;
  folderId?: string;
  actionItems?: ActionItem[];
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
}

const DEFAULT_SETTINGS: Settings = {
  vizTheme: 'bars',
  highlightKeywords: false,
  template: 'general',
  claudeKey: '',
  useCloud: false,
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
  // Never write the user's API key into a shareable backup file
  if (data.mg_settings && typeof data.mg_settings === 'object') {
    delete (data.mg_settings as Record<string, unknown>).claudeKey;
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
