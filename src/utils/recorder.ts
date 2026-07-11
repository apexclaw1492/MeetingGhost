/* SegmentedRecorder: rotates MediaRecorder every SEGMENT_MS so each segment is
   a complete, independently decodable file, written and verified to durable
   storage the moment it closes. A crash/kill at any point loses at most the
   current in-flight segment (≤60s), never the meeting.

   Rotation also happens on visibility loss and audio-track interruptions
   (calls, Siri, route changes) so completed audio is flushed before iOS can
   suspend the WebView. */

import { writeSegment, freeBytes, STORAGE_WARN_BYTES, STORAGE_STOP_BYTES } from './audioStore';
import { log, logError } from './diag';

export const SEGMENT_MS = 60_000;

export interface SegmentInfo { seg: number; bytes: number; ms: number; }

export interface RecorderCallbacks {
  onSegmentSaved: (info: SegmentInfo) => void;
  onSegmentFailed: (seg: number, error: string) => void;
  /* storage warning (free bytes low) — UI shows banner */
  onStorageWarning: (freeB: number) => void;
  /* storage critically low — recorder has already stopped safely */
  onAutoStop: (reason: string) => void;
  onInterruption: (kind: string) => void;
}

export class SegmentedRecorder {
  private stream: MediaStream | null = null;
  private mr: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private seg = 0;
  private segStart = 0;
  private rotateTimer: number | null = null;
  private stopping = false;
  private rotating = false;
  private writeChain: Promise<void> = Promise.resolve();
  public mimeType = '';
  public totalBytes = 0;
  public recordedMs = 0;

  private meetingId: string;
  private cb: RecorderCallbacks;

  constructor(meetingId: string, cb: RecorderCallbacks) {
    this.meetingId = meetingId;
    this.cb = cb;
  }

  get isActive() { return !!this.mr && !this.stopping; }

  async start(stream: MediaStream): Promise<void> {
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.onmute = () => { log('rec.track.muted', { id: this.meetingId }); this.cb.onInterruption('muted'); this.flushCurrent(); };
      track.onunmute = () => log('rec.track.unmuted', { id: this.meetingId });
      track.onended = () => { log('rec.track.ended', { id: this.meetingId }); this.cb.onInterruption('ended'); this.flushCurrent(); };
    }
    const free = await freeBytes();
    log('rec.start', { id: this.meetingId, freeMB: free !== null ? Math.round(free / 1048576) : 'unknown' });
    if (free !== null && free < STORAGE_STOP_BYTES) {
      throw new Error('Not enough free storage to record safely. Free up space and try again.');
    }
    if (free !== null && free < STORAGE_WARN_BYTES) this.cb.onStorageWarning(free);
    this.startSegment();
  }

  private startSegment() {
    if (!this.stream || this.stopping) return;
    const mr = new MediaRecorder(this.stream);
    if (!this.mimeType) this.mimeType = mr.mimeType || 'audio/mp4';
    this.mr = mr;
    this.chunks = [];
    this.segStart = performance.now();
    mr.ondataavailable = e => { if (e.data.size > 0) this.chunks.push(e.data); };
    mr.onerror = (e: Event) => {
      logError('rec.mediarecorder.error', (e as { error?: unknown }).error || 'unknown');
      this.cb.onInterruption('recorder-error');
      this.flushCurrent();
    };
    mr.onstop = () => this.finalizeSegment();
    // 5s timeslice bounds in-memory data between rotations
    mr.start(5000);
    this.rotateTimer = window.setTimeout(() => this.rotate(), SEGMENT_MS);
  }

  /* Close the current segment and immediately open the next one. */
  private rotate() {
    if (!this.mr || this.mr.state === 'inactive' || this.stopping || this.rotating) return;
    this.rotating = true;
    this.mr.stop(); // finalizeSegment() runs from onstop, then restarts
  }

  /* Flush without stopping the session — used on interruptions/visibility loss */
  flushCurrent() {
    if (!this.mr || this.mr.state === 'inactive' || this.stopping || this.rotating) return;
    const elapsed = performance.now() - this.segStart;
    if (elapsed < 1500) return; // nothing meaningful to flush yet
    log('rec.flush', { id: this.meetingId, seg: this.seg, elapsedMs: Math.round(elapsed) });
    this.rotate();
  }

  private finalizeSegment() {
    if (this.rotateTimer !== null) { clearTimeout(this.rotateTimer); this.rotateTimer = null; }
    const segNo = this.seg;
    const ms = Math.round(performance.now() - this.segStart);
    const blob = this.chunks.length ? new Blob(this.chunks, { type: this.chunks[0].type || this.mimeType }) : null;
    this.chunks = [];
    this.seg++;

    if (blob && blob.size > 0) {
      // Serialize writes so segments land in order; failures keep prior segments.
      this.writeChain = this.writeChain.then(async () => {
        try {
          await writeSegment(this.meetingId, segNo, blob);
          this.totalBytes += blob.size;
          this.recordedMs += ms;
          this.cb.onSegmentSaved({ seg: segNo, bytes: blob.size, ms });
        } catch (e) {
          logError('rec.segment.write.fail', e, { seg: segNo });
          this.cb.onSegmentFailed(segNo, e instanceof Error ? e.message : String(e));
        }
        const free = await freeBytes();
        if (free !== null && free < STORAGE_STOP_BYTES && !this.stopping) {
          log('rec.autostop.storage', { freeMB: Math.round(free / 1048576) });
          this.cb.onAutoStop('Storage critically low — recording stopped safely; all completed audio is saved.');
          void this.stop();
        } else if (free !== null && free < STORAGE_WARN_BYTES) {
          this.cb.onStorageWarning(free);
        }
      });
    }

    // Keep recording unless a real stop was requested
    if (!this.stopping) {
      this.rotating = false;
      this.startSegment();
    }
  }

  /* Full stop: finalize in-flight segment, wait for ALL verified writes. */
  async stop(): Promise<{ segments: number; totalBytes: number; recordedMs: number; mimeType: string }> {
    this.stopping = true;
    if (this.rotateTimer !== null) { clearTimeout(this.rotateTimer); this.rotateTimer = null; }
    if (this.mr && this.mr.state !== 'inactive') {
      await new Promise<void>(resolve => {
        const prev = this.mr!.onstop as (() => void) | null;
        this.mr!.onstop = () => { if (prev) prev.call(this.mr); resolve(); };
        this.mr!.stop();
      });
    }
    await this.writeChain; // every segment verified on disk before we return
    this.stream?.getTracks().forEach(t => { t.onmute = null; t.onunmute = null; t.onended = null; t.stop(); });
    this.stream = null;
    this.mr = null;
    log('rec.stop', { id: this.meetingId, segments: this.seg, bytes: this.totalBytes, ms: this.recordedMs });
    return { segments: this.seg, totalBytes: this.totalBytes, recordedMs: this.recordedMs, mimeType: this.mimeType };
  }
}
