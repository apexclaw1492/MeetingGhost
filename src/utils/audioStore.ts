/* Durable segment storage for recordings.

   Native (iOS/Android): files under Directory.Data via @capacitor/filesystem —
   real app-container storage written by native code, survives WebView resets
   and is NOT subject to WKWebView website-data eviction (IndexedDB is).
   Web fallback: IndexedDB ('audio' store, key "<id>:seg:<n>").

   Every write is verified (stat/read-back of byte length) before the segment
   is considered saved. Reads return Blobs; callers never hold more than one
   segment in memory at a time. */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { idb } from './idb';
import { log, logError } from './diag';
import { segmentIdsFromKeys, segmentIdsFromNames } from './segmentManifest';
import { withTimeout } from './async.ts';

/* App-local native plugin (ios/App/App/FreeDiskPlugin.swift) — WKWebView has
   no honest view of device free space, so we ask the OS directly. */
const FreeDisk = registerPlugin<{ free(): Promise<{ free: number; total: number }> }>('FreeDisk');

const isNative = () => Capacitor.isNativePlatform();
const dirFor = (meetingId: string) => `recordings/${meetingId}`;
const pathFor = (meetingId: string, seg: number) => `${dirFor(meetingId)}/seg-${seg}`;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/* Writes one segment and VERIFIES it landed (size check). Throws on failure —
   callers keep previously verified segments regardless. */
export async function writeSegment(meetingId: string, seg: number, blob: Blob): Promise<void> {
  if (isNative()) {
    const data = await blobToBase64(blob);
    await Filesystem.writeFile({
      path: pathFor(meetingId, seg), data,
      directory: Directory.Data, recursive: true,
    });
    const st = await Filesystem.stat({ path: pathFor(meetingId, seg), directory: Directory.Data });
    if (Number(st.size) !== blob.size) {
      throw new Error(`Segment ${seg} verification failed: wrote ${blob.size}B, stat ${st.size}B`);
    }
  } else {
    await idb.put('audio', `${meetingId}:seg:${seg}`, blob);
    const back = await idb.get<Blob>('audio', `${meetingId}:seg:${seg}`);
    if (!back || back.size !== blob.size) {
      throw new Error(`Segment ${seg} verification failed (IndexedDB)`);
    }
  }
  log('audio.segment.written', { meetingId, seg, bytes: blob.size, native: isNative() });
}

/** Raw app-container URI for native consumers and direct WebView playback. */
export async function segmentNativeUri(meetingId: string, seg: number): Promise<string | null> {
  try {
    const res = await Filesystem.getUri({ path: pathFor(meetingId, seg), directory: Directory.Data });
    return res.uri || null;
  } catch { return null; }
}

/* Absolute filesystem path of a segment for native transcription plugins.
   The native plugin reads the file directly — no base64 crosses the WebView. */
export async function segmentNativePath(meetingId: string, seg: number): Promise<string | null> {
  const uri = await segmentNativeUri(meetingId, seg);
  return uri ? uri.replace(/^file:\/\//, '') : null;
}

export async function readSegment(meetingId: string, seg: number, mimeType: string): Promise<Blob | null> {
  try {
    if (isNative()) {
      const res = await Filesystem.readFile({ path: pathFor(meetingId, seg), directory: Directory.Data });
      return base64ToBlob(res.data as string, mimeType);
    }
    return (await idb.get<Blob>('audio', `${meetingId}:seg:${seg}`)) || null;
  } catch (e) {
    logError('audio.segment.read.fail', e, { meetingId, seg });
    return null;
  }
}

/* Lists exact verified segment numbers on disk. A manifest is safer than a
   count: if seg-12 fails but seg-13 saves, both playback and transcription
   must skip the hole without discarding valid later audio. */
export async function listSegmentsOnDisk(meetingId: string): Promise<number[]> {
  try {
    if (isNative()) {
      const res = await Filesystem.readdir({ path: dirFor(meetingId), directory: Directory.Data });
      return segmentIdsFromNames(res.files.map(f => f.name));
    }
    const keys = await idb.keys('audio');
    return segmentIdsFromKeys(meetingId, keys);
  } catch { return []; }
}

export interface StoredAudioManifest {
  meetingId: string;
  segmentIds: number[];
  totalBytes: number;
}

/**
 * Enumerates verified audio independently of localStorage meeting metadata.
 * This is the last-resort recovery boundary when WebView data is cleared but
 * app-private native files (or IndexedDB audio) still survive.
 */
export async function listStoredAudioManifests(): Promise<StoredAudioManifest[]> {
  try {
    if (isNative()) {
      // A new install legitimately has no recordings root. Create the empty
      // container first so a later readdir failure means real I/O trouble and
      // can be surfaced instead of being mistaken for "no recordings".
      try {
        await Filesystem.stat({ path: 'recordings', directory: Directory.Data });
      } catch {
        await Filesystem.mkdir({ path: 'recordings', directory: Directory.Data, recursive: true });
      }
      const meetings = await Filesystem.readdir({ path: 'recordings', directory: Directory.Data });
      const manifests: StoredAudioManifest[] = [];
      for (const entry of meetings.files) {
        const meetingId = entry.name;
        if (!/^[A-Za-z0-9_-]+$/.test(meetingId)) continue;
        try {
          const contents = await Filesystem.readdir({ path: dirFor(meetingId), directory: Directory.Data });
          const segmentIds = segmentIdsFromNames(contents.files.map(file => file.name));
          if (!segmentIds.length) continue;
          const completed = new Set(segmentIds.map(segment => `seg-${segment}`));
          const totalBytes = contents.files.reduce(
            (sum, file) => completed.has(file.name) ? sum + Math.max(0, Number(file.size) || 0) : sum,
            0,
          );
          manifests.push({ meetingId, segmentIds, totalBytes });
        } catch (error) {
          logError('audio.manifest.directory.fail', error, { meetingId });
          throw new Error(`Could not inspect saved audio for ${meetingId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return manifests;
    }

    const keys = await idb.keys('audio');
    const meetingIds = new Set<string>();
    for (const key of keys) {
      const match = /^(.+):seg:\d+$/.exec(String(key));
      if (match) meetingIds.add(match[1]);
    }
    const manifests: StoredAudioManifest[] = [];
    for (const meetingId of meetingIds) {
      const segmentIds = segmentIdsFromKeys(meetingId, keys);
      let totalBytes = 0;
      for (const segment of segmentIds) {
        const blob = await idb.get<Blob>('audio', `${meetingId}:seg:${segment}`);
        if (!blob) throw new Error(`Saved audio index points to a missing segment: ${meetingId}/seg-${segment}`);
        totalBytes += blob.size;
      }
      if (segmentIds.length) manifests.push({ meetingId, segmentIds, totalBytes });
    }
    return manifests;
  } catch (error) {
    logError('audio.manifest.scan.fail', error);
    throw new Error(`Could not enumerate saved recordings: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function countSegmentsOnDisk(meetingId: string): Promise<number> {
  return (await listSegmentsOnDisk(meetingId)).length;
}

export async function deleteMeetingAudio(meetingId: string): Promise<void> {
  try {
    if (isNative()) {
      await Filesystem.rmdir({ path: dirFor(meetingId), directory: Directory.Data, recursive: true });
    } else {
      const keys = await idb.keys('audio');
      for (const k of keys) {
        if (String(k).startsWith(`${meetingId}:seg:`) || String(k) === meetingId) {
          await idb.del('audio', String(k));
        }
      }
    }
    // Legacy v9.0 single-blob key
    await idb.del('audio', meetingId).catch(() => { /* not present */ });
  } catch (e) { logError('audio.delete.fail', e, { meetingId }); }
}

/* True free bytes on the device (native plugin) or an origin-quota estimate
   (web). Returns null when unknowable — callers must treat null as "unknown",
   never as "plenty". */
export async function freeBytes(): Promise<number | null> {
  try {
    if (isNative()) {
      const r = await withTimeout(
        FreeDisk.free(),
        5_000,
        'Device free-space check timed out.',
      );
      const available = r.free >= 0 ? r.free : null;
      log('storage.free.checked', { native: true, freeBytes: available ?? 'unknown', totalBytes: r.total });
      return available;
    }
    const estimate = navigator.storage?.estimate?.();
    const est = estimate
      ? await withTimeout(estimate, 5_000, 'Browser storage estimate timed out.')
      : undefined;
    if (est?.quota != null && est.usage != null) {
      const available = est.quota - est.usage;
      log('storage.free.checked', { native: false, freeBytes: available, quotaBytes: est.quota, usageBytes: est.usage });
      return available;
    }
    log('storage.free.checked', { native: false, freeBytes: 'unknown' });
    return null;
  } catch (error) {
    logError('storage.free.check.fail', error, { native: isNative() });
    return null;
  }
}

export const STORAGE_WARN_BYTES = 500 * 1024 * 1024;  // warn below 500 MB
export const STORAGE_STOP_BYTES = 100 * 1024 * 1024;  // auto-stop below 100 MB
