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
  transcriptStored?: boolean;  // full text is durable in IDB; local metadata may omit it
  transcriptOutcome?: 'text' | 'no_speech'; // explicit terminal result; never infer silence from missing text
  transcriptChars?: number;    // expected UTF-16 length of the complete transcript
  transcriptBytes?: number;    // expected UTF-8 byte length of the complete transcript
  transcriptChecksum?: string; // versioned whole-transcript integrity fingerprint
  summary: string;
  folderId?: string;
  actionItems?: ActionItem[];
  status?: MeetingStatus;
  segments?: number;           // verified segment count on disk
  segmentIds?: number[];       // exact verified file ids; survives gaps after a failed write
  bytes?: number;              // verified audio bytes on disk
  mimeType?: string;           // segment container type
  audioKind?: 'segments' | 'single'; // 'single' = legacy v9 blob / uploaded file
  tNext?: number;              // transcription checkpoint: next segment index
  tParts?: string[];           // per-segment transcripts until assembly
  tSubSegment?: number;        // current manifest position split into bounded inference units
  tSubNext?: number;           // next bounded unit within tSubSegment
  tSubTotal?: number;          // expected bounded units; detects incomplete sub-checkpoints
  tSubParts?: string[];        // per-unit transcripts for a long imported segment
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

export function exportBackup(hydratedMeetings?: MeetingRecord[]): string {
  const data: Record<string, unknown> = { _meetingghost: 1, exportedAt: new Date().toISOString() };
  for (const k of BACKUP_KEYS) {
    const v = localStorage.getItem(k);
    if (v !== null) { try { data[k] = JSON.parse(v); } catch { data[k] = v; } }
  }
  // The normal localStorage record intentionally omits transcript bodies once
  // they are durable in IndexedDB. Backups must contain the hydrated records.
  if (hydratedMeetings) data.mg_h = hydratedMeetings;
  // Never write the user's API keys/tokens into a shareable backup file
  if (data.mg_settings && typeof data.mg_settings === 'object') {
    delete (data.mg_settings as Record<string, unknown>).claudeKey;
    delete (data.mg_settings as Record<string, unknown>).githubToken;
  }
  return JSON.stringify(data, null, 2);
}

/* Parse + merge without writing. The caller archives large transcript bodies
   before committing compact metadata, avoiding a localStorage quota spike. */
export function mergeBackup(
  json: string,
  currentMeetings: MeetingRecord[] = store.loadMeetings(),
  currentFolders: Folder[] = store.loadFolders(),
): { meetings: MeetingRecord[]; folders: Folder[]; settings?: Partial<Settings> } {
  const data = JSON.parse(json);
  if (!data || data._meetingghost !== 1) throw new Error('Not a MeetingGhost backup file.');

  const mergeById = <T extends { id: string }>(current: T[], incoming: unknown): T[] => {
    if (!Array.isArray(incoming)) return current;
    const have = new Set(current.map(x => x.id));
    return [...current, ...(incoming as T[]).filter(x => x && x.id && !have.has(x.id))];
  };

  const mergeMeetings = (current: MeetingRecord[], incoming: unknown): MeetingRecord[] => {
    if (!Array.isArray(incoming)) return current;
    const incomingMeetings = (incoming as MeetingRecord[]).filter(meeting => meeting && meeting.id);
    const incomingById = new Map(incomingMeetings.map(meeting => [meeting.id, meeting]));
    const merged = current.map(meeting => {
      const backup = incomingById.get(meeting.id);
      if (!backup) return meeting;

      // Current recording/session metadata remains authoritative, but a backup
      // may repair content that compact metadata says was archived even when
      // that local archive is now unavailable. Mark restored inline text as
      // unarchived so the caller must write+verify it before compacting again.
      const restoredTranscript = meeting.transcript || backup.transcript || '';
      const recoveredFromBackup = !meeting.transcript && !!backup.transcript;
      return {
        ...meeting,
        transcript: restoredTranscript,
        transcriptStored: recoveredFromBackup ? false : meeting.transcriptStored,
        transcriptOutcome: recoveredFromBackup ? 'text' : meeting.transcriptOutcome,
        transcriptChars: recoveredFromBackup ? undefined : meeting.transcriptChars,
        transcriptBytes: recoveredFromBackup ? undefined : meeting.transcriptBytes,
        transcriptChecksum: recoveredFromBackup ? undefined : meeting.transcriptChecksum,
        title: meeting.title || backup.title,
        summary: meeting.summary || backup.summary || '',
        actionItems: meeting.actionItems?.length ? meeting.actionItems : backup.actionItems,
      };
    });
    const currentIds = new Set(current.map(meeting => meeting.id));
    return [...merged, ...incomingMeetings.filter(meeting => !currentIds.has(meeting.id))];
  };

  return {
    meetings: mergeMeetings(currentMeetings, data.mg_h),
    folders: mergeById(currentFolders, data.mg_f),
    settings: data.mg_settings && typeof data.mg_settings === 'object' ? data.mg_settings : undefined,
  };
}
