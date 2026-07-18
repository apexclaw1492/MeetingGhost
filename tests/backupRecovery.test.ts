import test from 'node:test';
import assert from 'node:assert/strict';
import { exportBackup, mergeBackup } from '../src/utils/store.ts';
import type { MeetingRecord } from '../src/utils/store.ts';

function backup(meetings: MeetingRecord[]): string {
  return JSON.stringify({ _meetingghost: 1, mg_h: meetings });
}

test('backup restore repairs a missing archived transcript for an existing meeting id', () => {
  const current: MeetingRecord = {
    id: 'same', date: 'Current', dur: 3600, title: 'Current title',
    transcript: '', transcriptStored: true, summary: '', status: 'complete',
    segments: 240, segmentIds: [0, 1, 2], bytes: 12345,
  };
  const fromBackup: MeetingRecord = {
    id: 'same', date: 'Older backup', dur: 3600, title: 'Backup title',
    transcript: 'complete restored transcript with the final marker',
    transcriptStored: true, summary: 'Restored summary', status: 'complete',
    actionItems: [{ text: 'Verify recovery', done: false }],
  };

  const [restored] = mergeBackup(backup([fromBackup]), [current], []).meetings;
  assert.equal(restored.transcript, fromBackup.transcript);
  assert.equal(restored.transcriptStored, false, 'restored inline text must be re-archived and verified');
  assert.equal(restored.summary, 'Restored summary');
  assert.deepEqual(restored.actionItems, fromBackup.actionItems);
  assert.equal(restored.title, 'Current title');
  assert.deepEqual(restored.segmentIds, current.segmentIds);
  assert.equal(restored.bytes, current.bytes);
});

test('backup restore never replaces a valid current transcript with a stale duplicate', () => {
  const current: MeetingRecord = {
    id: 'same', date: 'Current', dur: 60, title: 'Current',
    transcript: 'new complete transcript', transcriptStored: false,
    summary: 'New summary', status: 'complete',
  };
  const stale: MeetingRecord = {
    ...current,
    transcript: 'old backup transcript',
    summary: 'Old summary',
  };

  const [restored] = mergeBackup(backup([stale]), [current], []).meetings;
  assert.equal(restored.transcript, current.transcript);
  assert.equal(restored.summary, current.summary);
});

test('backup restore still adds meetings that are not present locally', () => {
  const incoming: MeetingRecord = {
    id: 'new', date: 'Backup', dur: 120, title: 'Recovered meeting',
    transcript: 'complete backup transcript', summary: '', status: 'complete',
  };
  const restored = mergeBackup(backup([incoming]), [], []).meetings;
  assert.deepEqual(restored, [incoming]);
});

test('backup export replaces compact metadata with the complete hydrated transcript', () => {
  const values = new Map<string, string>([
    ['mg_h', JSON.stringify([{
      id: 'archived', date: 'Today', dur: 7200, title: 'Archived',
      transcript: '', transcriptStored: true, summary: 'Complete summary', status: 'complete',
    }])],
    ['mg_settings', JSON.stringify({ claudeKey: 'secret', githubToken: 'secret', githubRepo: 'owner/repo' })],
  ]);
  const fakeStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeStorage });
  try {
    const finalMarker = 'FINAL-BACKUP-MARKER-999';
    const hydrated: MeetingRecord = {
      id: 'archived', date: 'Today', dur: 7200, title: 'Archived',
      transcript: `complete hydrated transcript ${finalMarker}`,
      transcriptStored: true, summary: 'Complete summary', status: 'complete',
    };
    const exported = JSON.parse(exportBackup([hydrated]));
    assert.equal(exported.mg_h[0].transcript.endsWith(finalMarker), true);
    assert.equal(exported.mg_h[0].summary, 'Complete summary');
    assert.equal('claudeKey' in exported.mg_settings, false);
    assert.equal('githubToken' in exported.mg_settings, false);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage });
  }
});
