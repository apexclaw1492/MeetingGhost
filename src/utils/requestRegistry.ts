/**
 * Correlates asynchronous worker replies with the request that created them.
 * Late replies are ignored after timeout instead of resolving a newer request.
 */
export class RequestRegistry<T> {
  private sequence = 0;
  private pending = new Map<number, {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
  }>();

  create(timeoutMs: number, timeoutMessage: string): { requestId: number; promise: Promise<T> } {
    const requestId = ++this.sequence;
    const promise = new Promise<T>((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => this.reject(requestId, new Error(timeoutMessage)), timeoutMs)
        : null;
      this.pending.set(requestId, { resolve, reject, timer });
    });
    return { requestId, promise };
  }

  resolve(requestId: number, value: T): boolean {
    const request = this.take(requestId);
    if (!request) return false;
    request.resolve(value);
    return true;
  }

  reject(requestId: number, error: Error): boolean {
    const request = this.take(requestId);
    if (!request) return false;
    request.reject(error);
    return true;
  }

  rejectAll(error: Error): void {
    for (const requestId of [...this.pending.keys()]) this.reject(requestId, error);
  }

  get size(): number { return this.pending.size; }

  private take(requestId: number) {
    const request = this.pending.get(requestId);
    if (!request) return null;
    this.pending.delete(requestId);
    if (request.timer !== null) clearTimeout(request.timer);
    return request;
  }
}
