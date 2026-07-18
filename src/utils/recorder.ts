/* SegmentedRecorder: rotates MediaRecorder every SEGMENT_MS so each segment is
   a complete, independently decodable file, written and verified to durable
   storage the moment it closes. A crash/kill at any point loses at most the
   current in-flight segment (≤60s), never the meeting.

   Rotation also happens on visibility loss and audio-track interruptions
   (calls, Siri, route changes) so completed audio is flushed before iOS can
   suspend the WebView. */

export const SEGMENT_MS = 60_000;

export interface SegmentInfo { seg: number; bytes: number; ms: number; }

export interface RecorderStopResult {
  segments: number;
  segmentIds: number[];
  failedSegments: number[];
  totalBytes: number;
  recordedMs: number;
  mimeType: string;
}

export interface RecorderCallbacks {
  onSegmentSaved: (info: SegmentInfo) => void;
  onSegmentFailed: (seg: number, error: string) => void;
  /* storage warning (free bytes low) — UI shows banner */
  onStorageWarning: (freeB: number) => void;
  /* storage critically low — recorder has already stopped safely */
  onAutoStop: (reason: string) => void;
  onInterruption: (kind: string) => void;
  onMemoryPressure?: (level: number | string) => void;
}

export interface RecorderDependencies {
  writeSegment: (meetingId: string, segment: number, blob: Blob) => Promise<void>;
  freeBytes: () => Promise<number | null>;
  storageWarnBytes: number;
  storageStopBytes: number;
  log: (event: string, data?: Record<string, unknown>) => void;
  logError: (event: string, error: unknown, data?: Record<string, unknown>) => void;
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
  private finalizePromise: Promise<void> | null = null;
  private finalizeResolve: (() => void) | null = null;
  private stopPromise: Promise<RecorderStopResult> | null = null;
  private autoStopNotified = false;
  public mimeType = '';
  public totalBytes = 0;
  public recordedMs = 0;
  public segmentIds: number[] = [];
  public failedSegments: number[] = [];

  private meetingId: string;
  private cb: RecorderCallbacks;
  private deps: RecorderDependencies;

  constructor(meetingId: string, cb: RecorderCallbacks, dependencies: RecorderDependencies) {
    this.meetingId = meetingId;
    this.cb = cb;
    this.deps = dependencies;
  }

  get isActive() { return !!this.mr && !this.stopping; }

  async start(stream: MediaStream): Promise<void> {
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.onmute = () => { this.deps.log('rec.track.muted', { id: this.meetingId }); this.cb.onInterruption('muted'); this.flushCurrent(); };
      track.onunmute = () => this.deps.log('rec.track.unmuted', { id: this.meetingId });
      track.onended = () => {
        this.deps.log('rec.track.ended', { id: this.meetingId });
        this.cb.onInterruption('ended');
        this.requestAutoStop('Audio input ended — recording stopped safely and all completed audio was preserved.');
      };
    }
    const free = await this.deps.freeBytes();
    this.deps.log('rec.start', { id: this.meetingId, freeMB: free !== null ? Math.round(free / 1048576) : 'unknown' });
    if (free !== null && free < this.deps.storageStopBytes) {
      throw new Error('Not enough free storage to record safely. Free up space and try again.');
    }
    if (free !== null && free < this.deps.storageWarnBytes) this.cb.onStorageWarning(free);
    this.startSegment();
  }

  private startSegment() {
    if (!this.stream || this.stopping) return;
    let mr: MediaRecorder;
    try {
      mr = new MediaRecorder(this.stream);
    } catch (e) {
      this.deps.logError('rec.mediarecorder.create.fail', e);
      this.requestAutoStop('The audio recorder could not continue after an interruption. Saved audio was preserved.');
      return;
    }
    if (!this.mimeType) this.mimeType = mr.mimeType || 'audio/mp4';
    this.mr = mr;
    this.chunks = [];
    this.segStart = performance.now();
    mr.ondataavailable = e => { if (e.data.size > 0) this.chunks.push(e.data); };
    mr.onerror = (e: Event) => {
      this.deps.logError('rec.mediarecorder.error', (e as { error?: unknown }).error || 'unknown');
      this.cb.onInterruption('recorder-error');
      this.requestAutoStop('The audio recorder reported an error and stopped safely. Completed audio was preserved.');
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
    this.finalizePromise = new Promise(resolve => { this.finalizeResolve = resolve; });
    this.mr.stop(); // finalizeSegment() runs from onstop, then restarts
  }

  /* Flush without stopping the session — used on interruptions/visibility loss */
  flushCurrent() {
    if (!this.mr || this.mr.state === 'inactive' || this.stopping || this.rotating) return;
    const elapsed = performance.now() - this.segStart;
    if (elapsed < 1500) return; // nothing meaningful to flush yet
    this.deps.log('rec.flush', { id: this.meetingId, seg: this.seg, elapsedMs: Math.round(elapsed) });
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
          await this.deps.writeSegment(this.meetingId, segNo, blob);
          this.totalBytes += blob.size;
          this.recordedMs += ms;
          this.segmentIds.push(segNo);
          this.cb.onSegmentSaved({ seg: segNo, bytes: blob.size, ms });
        } catch (e) {
          this.failedSegments.push(segNo);
          this.deps.logError('rec.segment.write.fail', e, { seg: segNo });
          this.cb.onSegmentFailed(segNo, e instanceof Error ? e.message : String(e));
        }
        const free = await this.deps.freeBytes();
        if (free !== null && free < this.deps.storageStopBytes && !this.stopping) {
          this.deps.log('rec.autostop.storage', { freeMB: Math.round(free / 1048576) });
          this.requestAutoStop('Storage critically low — recording stopped safely; all completed audio is saved.');
        } else if (free !== null && free < this.deps.storageWarnBytes) {
          this.cb.onStorageWarning(free);
        }
      });
    }

    // Keep recording unless a real stop was requested
    if (!this.stopping) {
      this.rotating = false;
      this.startSegment();
    }
    this.finalizeResolve?.();
    this.finalizeResolve = null;
    this.finalizePromise = null;
  }

  private requestAutoStop(reason: string) {
    if (this.autoStopNotified) return;
    this.autoStopNotified = true;
    void this.stop();
    this.cb.onAutoStop(reason);
  }

  /* Full stop: finalize in-flight segment, wait for ALL verified writes. */
  stop(): Promise<RecorderStopResult> {
    if (!this.stopPromise) this.stopPromise = this.performStop();
    return this.stopPromise;
  }

  private async performStop(): Promise<RecorderStopResult> {
    this.stopping = true;
    if (this.rotateTimer !== null) { clearTimeout(this.rotateTimer); this.rotateTimer = null; }
    if (this.mr && this.mr.state !== 'inactive') {
      await new Promise<void>(resolve => {
        const prev = this.mr!.onstop as (() => void) | null;
        this.mr!.onstop = () => { if (prev) prev.call(this.mr); resolve(); };
        this.mr!.stop();
      });
    } else if (this.finalizePromise) {
      // Stop can land after rotate() made MediaRecorder inactive but before its
      // onstop callback persisted the segment. Never return ahead of that work.
      await this.finalizePromise;
    }
    await this.writeChain; // every segment verified on disk before we return
    this.stream?.getTracks().forEach(t => { t.onmute = null; t.onunmute = null; t.onended = null; t.stop(); });
    this.stream = null;
    this.mr = null;
    this.deps.log('rec.stop', { id: this.meetingId, segments: this.segmentIds.length, failed: this.failedSegments.length, bytes: this.totalBytes, ms: this.recordedMs });
    return {
      segments: this.segmentIds.length,
      segmentIds: [...this.segmentIds],
      failedSegments: [...this.failedSegments],
      totalBytes: this.totalBytes,
      recordedMs: this.recordedMs,
      mimeType: this.mimeType,
    };
  }
}
