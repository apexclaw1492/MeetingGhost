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

/* Counts verified segments on disk — used by crash recovery to reconstruct
   what actually survived, independent of what the UI believed. */
export async function countSegmentsOnDisk(meetingId: string): Promise<number> {
  try {
    if (isNative()) {
      const res = await Filesystem.readdir({ path: dirFor(meetingId), directory: Directory.Data });
      return res.files.filter(f => f.name.startsWith('seg-')).length;
    }
    const keys = await idb.keys('audio');
    return keys.filter(k => String(k).startsWith(`${meetingId}:seg:`)).length;
  } catch { return 0; }
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
      const r = await FreeDisk.free();
      return r.free >= 0 ? r.free : null;
    }
    const est = await navigator.storage?.estimate?.();
    if (est?.quota != null && est.usage != null) return est.quota - est.usage;
    return null;
  } catch { return null; }
}

export const STORAGE_WARN_BYTES = 500 * 1024 * 1024;  // warn below 500 MB
export const STORAGE_STOP_BYTES = 100 * 1024 * 1024;  // auto-stop below 100 MB
