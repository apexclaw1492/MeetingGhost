export type ModelInitKind = 'whisper' | 'gemma' | 'embed';
export type ModelInitTimeoutReason = 'stalled' | 'deadline';

export interface ModelInitLimits {
  idleMs: number;
  hardMs: number;
}

type Timer = ReturnType<typeof setTimeout>;
type Schedule = (callback: () => void, delayMs: number) => Timer;
type Cancel = (timer: Timer) => void;

interface ActiveInit {
  initId: number;
  idleTimer: Timer;
  hardTimer: Timer;
  limits: ModelInitLimits;
  onTimeout: (reason: ModelInitTimeoutReason) => void;
}

/**
 * Correlates model initialization replies and guarantees a terminal outcome.
 * Progress extends only the inactivity deadline; the absolute deadline still
 * prevents a worker from keeping the UI alive forever with repeated updates.
 */
export class ModelInitWatchdog {
  private sequence = 0;
  private active = new Map<ModelInitKind, ActiveInit>();
  private readonly schedule: Schedule;
  private readonly cancelTimer: Cancel;

  constructor(
    schedule: Schedule = (callback, delayMs) => setTimeout(callback, delayMs),
    cancelTimer: Cancel = timer => clearTimeout(timer),
  ) {
    this.schedule = schedule;
    this.cancelTimer = cancelTimer;
  }

  begin(kind: ModelInitKind, limits: ModelInitLimits, onTimeout: (reason: ModelInitTimeoutReason) => void): number {
    this.cancel(kind);
    const initId = ++this.sequence;
    const active = {} as ActiveInit;
    active.initId = initId;
    active.limits = limits;
    active.onTimeout = onTimeout;
    active.idleTimer = this.schedule(() => this.timeout(kind, initId, 'stalled'), limits.idleMs);
    active.hardTimer = this.schedule(() => this.timeout(kind, initId, 'deadline'), limits.hardMs);
    this.active.set(kind, active);
    return initId;
  }

  isActive(kind: ModelInitKind): boolean {
    return this.active.has(kind);
  }

  isCurrent(kind: ModelInitKind, initId: unknown): initId is number {
    return typeof initId === 'number' && this.active.get(kind)?.initId === initId;
  }

  progress(kind: ModelInitKind, initId: unknown): boolean {
    const active = this.active.get(kind);
    if (!active || active.initId !== initId) return false;
    this.cancelTimer(active.idleTimer);
    active.idleTimer = this.schedule(
      () => this.timeout(kind, active.initId, 'stalled'),
      active.limits.idleMs,
    );
    return true;
  }

  finish(kind: ModelInitKind, initId: unknown): boolean {
    if (!this.isCurrent(kind, initId)) return false;
    this.cancel(kind);
    return true;
  }

  cancel(kind: ModelInitKind): void {
    const active = this.active.get(kind);
    if (!active) return;
    this.cancelTimer(active.idleTimer);
    this.cancelTimer(active.hardTimer);
    this.active.delete(kind);
  }

  cancelAll(): void {
    for (const kind of [...this.active.keys()]) this.cancel(kind);
  }

  private timeout(kind: ModelInitKind, initId: number, reason: ModelInitTimeoutReason): void {
    const active = this.active.get(kind);
    if (!active || active.initId !== initId) return;
    const onTimeout = active.onTimeout;
    this.cancel(kind);
    onTimeout(reason);
  }
}
