import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { RecorderCallbacks, RecorderStopResult, SegmentInfo } from './recorder';
import { withTimeout } from './async.ts';

export const NATIVE_SEGMENT_SECONDS = 15;

export interface NativeRecordingStatus {
  active: boolean;
  meetingId?: string;
  segmentIds?: number[];
  failedSegments?: number[];
  totalBytes?: number;
  recordedMs?: number;
  mimeType?: string;
  error?: string;
}

interface NativeSegmentEvent extends NativeRecordingStatus, SegmentInfo {
  freeBytes?: number;
  reason?: string;
  memoryPressureLevel?: number | string;
}

type NativeRecordingEventName = 'segmentSaved' | 'storageWarning' | 'recordingInterrupted' | 'recordingError' | 'autoStopped' | 'memoryPressure';

export interface RecordingSessionPlugin {
  start(options: {
    meetingId: string;
    segmentSeconds: number;
    warnBytes: number;
    stopBytes: number;
  }): Promise<NativeRecordingStatus>;
  stop(): Promise<NativeRecordingStatus>;
  flush(): Promise<NativeRecordingStatus>;
  status(): Promise<NativeRecordingStatus>;
  addListener(eventName: NativeRecordingEventName, listener: (event: NativeSegmentEvent) => void): Promise<PluginListenerHandle>;
}

const RecordingSession = registerPlugin<RecordingSessionPlugin>('RecordingSession');

export function nativeStatusResult(status: NativeRecordingStatus): RecorderStopResult {
  const segmentIds = Array.from(new Set((status.segmentIds || []).filter(Number.isInteger))).sort((a, b) => a - b);
  return {
    segments: segmentIds.length,
    segmentIds,
    failedSegments: Array.from(new Set((status.failedSegments || []).filter(Number.isInteger))).sort((a, b) => a - b),
    totalBytes: Math.max(0, Number(status.totalBytes) || 0),
    recordedMs: Math.max(0, Number(status.recordedMs) || 0),
    mimeType: status.mimeType || 'audio/mp4',
  };
}

export async function nativeRecordingStatus(): Promise<NativeRecordingStatus> {
  return RecordingSession.status();
}

export async function stopOrphanedNativeRecording(): Promise<NativeRecordingStatus> {
  const status = await RecordingSession.status();
  return status.active ? RecordingSession.stop() : status;
}

/**
 * Thin adapter around the platform recorder. Native code owns capture, atomic
 * segment finalization, storage checks, and screen-lock lifecycle; React owns
 * only visible state and the already-established saved-audio pipeline.
 */
export class NativeSegmentedRecorder {
  public mimeType = 'audio/mp4';
  public totalBytes = 0;
  public recordedMs = 0;
  public segmentIds: number[] = [];
  public failedSegments: number[] = [];

  private active = false;
  private startCanceled = false;
  private stopPromise: Promise<RecorderStopResult> | null = null;
  private listeners: PluginListenerHandle[] = [];
  private meetingId: string;
  private cb: RecorderCallbacks;
  private session: RecordingSessionPlugin;
  private deps: {
    storageWarnBytes: number;
    storageStopBytes: number;
    log: (event: string, data?: Record<string, unknown>) => void;
    logError: (event: string, error: unknown, data?: Record<string, unknown>) => void;
  };

  constructor(
    meetingId: string,
    cb: RecorderCallbacks,
    deps: {
      storageWarnBytes: number;
      storageStopBytes: number;
      log: (event: string, data?: Record<string, unknown>) => void;
      logError: (event: string, error: unknown, data?: Record<string, unknown>) => void;
    },
    session: RecordingSessionPlugin = RecordingSession,
  ) {
    this.meetingId = meetingId;
    this.cb = cb;
    this.deps = deps;
    this.session = session;
  }

  get isActive() { return this.active; }

  private applyStatus(status: NativeRecordingStatus) {
    const result = nativeStatusResult(status);
    this.mimeType = result.mimeType;
    this.totalBytes = result.totalBytes;
    this.recordedMs = result.recordedMs;
    this.segmentIds = result.segmentIds;
    this.failedSegments = result.failedSegments;
    this.active = status.active;
  }

  async start(): Promise<void> {
    this.startCanceled = false;
    const add = async <T extends NativeSegmentEvent>(name: NativeRecordingEventName, fn: (event: T) => void) => {
      const listener = await this.session.addListener(name, fn as (event: NativeSegmentEvent) => void);
      if (this.startCanceled) {
        await withTimeout(listener.remove(), 5_000, 'Late native recorder listener cleanup timed out.').catch(() => { /* cleanup only */ });
        throw new Error('Native recording startup was canceled before it completed.');
      }
      this.listeners.push(listener);
    };
    try {
      await add('segmentSaved', event => {
        this.applyStatus(event);
        this.deps.log('rec.native.segment.saved', {
          id: this.meetingId,
          seg: event.seg,
          bytes: event.bytes,
          ms: event.ms,
          freeBytes: event.freeBytes ?? 'unknown',
          total: this.segmentIds.length,
          totalBytes: this.totalBytes,
          recordedMs: this.recordedMs,
        });
        this.cb.onSegmentSaved({ seg: event.seg, bytes: event.bytes, ms: event.ms });
      });
      await add('storageWarning', event => {
        this.applyStatus(event);
        this.deps.log('rec.native.storage.warning', { id: this.meetingId, freeBytes: event.freeBytes || 0 });
        this.cb.onStorageWarning(Math.max(0, Number(event.freeBytes) || 0));
      });
      await add('recordingInterrupted', event => {
        this.applyStatus(event);
        this.deps.log('rec.native.interruption', {
          id: this.meetingId,
          reason: event.reason || 'native-interruption',
          active: event.active,
          segments: this.segmentIds.length,
          bytes: this.totalBytes,
          ms: this.recordedMs,
        });
        this.cb.onInterruption(event.reason || 'native-interruption');
      });
      await add('recordingError', event => {
        this.applyStatus(event);
        const message = event.error || event.reason || 'Native recording failed.';
        this.deps.logError('rec.native.error', message, { meetingId: this.meetingId });
        this.cb.onSegmentFailed(event.seg ?? this.segmentIds.length, message);
      });
      await add('autoStopped', event => {
        this.applyStatus(event);
        this.deps.log('rec.native.autostop', {
          id: this.meetingId,
          reason: event.reason || event.error || 'unknown',
          segments: this.segmentIds.length,
          failed: this.failedSegments.length,
          bytes: this.totalBytes,
          ms: this.recordedMs,
        });
        this.cb.onAutoStop(event.reason || event.error || 'The native recorder stopped safely.');
      });
      await add('memoryPressure', event => {
        this.applyStatus(event);
        const level = event.memoryPressureLevel ?? event.reason ?? 'unknown';
        this.deps.log('rec.native.memory.pressure', {
          id: this.meetingId,
          level,
          active: event.active,
          segments: this.segmentIds.length,
          bytes: this.totalBytes,
          ms: this.recordedMs,
          freeBytes: event.freeBytes ?? 'unknown',
        });
        this.cb.onMemoryPressure?.(level);
      });

      if (this.startCanceled) throw new Error('Native recording startup was canceled before capture began.');
      const status = await this.session.start({
        meetingId: this.meetingId,
        segmentSeconds: NATIVE_SEGMENT_SECONDS,
        warnBytes: this.deps.storageWarnBytes,
        stopBytes: this.deps.storageStopBytes,
      });
      if (this.startCanceled) {
        const stopped = await withTimeout(
          this.session.stop(),
          10_000,
          'Late native recording startup could not be stopped within 10 seconds.',
        );
        this.applyStatus(stopped);
        throw new Error('Native recording startup completed after cancellation and was stopped safely.');
      }
      this.applyStatus(status);
      if (!status.active) throw new Error(status.error || 'Native recording did not start.');
      this.deps.log('rec.native.start', {
        id: this.meetingId,
        active: status.active,
        segmentSeconds: NATIVE_SEGMENT_SECONDS,
        existingSegments: this.segmentIds.length,
        existingBytes: this.totalBytes,
      });
    } catch (error) {
      await this.removeListenersBounded();
      throw error;
    }
  }

  flushCurrent() {
    if (!this.active) return;
    void withTimeout(
      this.session.flush(),
      10_000,
      'Native recording flush did not complete within 10 seconds.',
    ).then(status => this.applyStatus(status)).catch(error => {
      this.deps.logError('rec.native.flush.fail', error, { id: this.meetingId });
    });
  }

  /** Reconcile terminal events that may have occurred while JS was suspended. */
  async reconcile(): Promise<NativeRecordingStatus> {
    const wasActive = this.active;
    const previousSegments = this.segmentIds.length;
    const status = await this.session.status();
    this.applyStatus(status);
    this.deps.log('rec.native.status', {
      id: this.meetingId,
      active: status.active,
      segments: this.segmentIds.length,
      failed: this.failedSegments.length,
      bytes: this.totalBytes,
      ms: this.recordedMs,
      error: status.error || '',
    });
    if (status.active && this.segmentIds.length > previousSegments) {
      this.deps.log('rec.native.reconciled', {
        id: this.meetingId,
        addedSegments: this.segmentIds.length - previousSegments,
        total: this.segmentIds.length,
      });
      this.cb.onSegmentSaved({
        seg: this.segmentIds[this.segmentIds.length - 1],
        bytes: 0,
        ms: 0,
      });
    }
    if (wasActive && !status.active) {
      this.cb.onAutoStop(status.error || 'The operating system stopped recording; every committed segment is safe.');
    }
    return status;
  }

  stop(): Promise<RecorderStopResult> {
    this.startCanceled = true;
    if (!this.stopPromise) this.stopPromise = this.performStop();
    return this.stopPromise;
  }

  private async performStop(): Promise<RecorderStopResult> {
    try {
      const status = await this.session.stop();
      this.applyStatus(status);
      this.deps.log('rec.native.stop', {
        id: this.meetingId,
        segments: this.segmentIds.length,
        bytes: this.totalBytes,
        ms: this.recordedMs,
      });
      return nativeStatusResult(status);
    } finally {
      this.active = false;
      await this.removeListenersBounded();
    }
  }

  private async removeListeners() {
    const listeners = this.listeners.splice(0);
    await Promise.all(listeners.map(listener => listener.remove().catch(() => { /* already detached */ })));
  }

  private async removeListenersBounded() {
    await withTimeout(
      this.removeListeners(),
      5_000,
      'Native recorder listener cleanup did not complete within 5 seconds.',
    ).catch(error => this.deps.logError('rec.native.listener.cleanup.fail', error, { id: this.meetingId }));
  }
}
