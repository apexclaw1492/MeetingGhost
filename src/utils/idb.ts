/* Minimal IndexedDB wrapper. Stores: vectors, audio, and large meeting text. */

const DB_NAME = 'meetingghost';
const DB_VERSION = 2;
const STORES = ['vectors', 'audio', 'content'] as const;
export type StoreName = typeof STORES[number];

let dbPromise: Promise<IDBDatabase> | null = null;
const OPEN_TIMEOUT_MS = 15_000;
const TX_TIMEOUT_MS = 30_000;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      dbPromise = null; // a later Retry gets a fresh open request
      reject(error);
    };
    const timer = setTimeout(() => finishError(new Error('Meeting storage did not open within 15 seconds. Close other MeetingGhost tabs and retry.')), OPEN_TIMEOUT_MS);
    req.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!req.result.objectStoreNames.contains(name)) {
          req.result.createObjectStore(name);
        }
      }
    };
    req.onsuccess = () => {
      if (settled) { req.result.close(); return; }
      settled = true;
      clearTimeout(timer);
      req.result.onversionchange = () => {
        req.result.close();
        dbPromise = null;
      };
      resolve(req.result);
    };
    req.onerror = () => finishError(req.error || new Error('Meeting storage could not be opened.'));
    req.onblocked = () => finishError(new Error('Meeting storage upgrade is blocked by another open tab. Close it and retry.'));
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = op(t.objectStore(store));
    let settled = false;
    let result: T;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      try { t.abort(); } catch { /* already completed */ }
      finishError(new Error(`Meeting storage ${mode} transaction timed out.`));
    }, TX_TIMEOUT_MS);
    req.onsuccess = () => { result = req.result; };
    req.onerror = () => finishError(req.error || new Error('Meeting storage request failed.'));
    t.oncomplete = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    t.onabort = () => finishError(t.error || new Error('Meeting storage transaction was aborted.'));
    t.onerror = () => finishError(t.error || new Error('Meeting storage transaction failed.'));
  }));
}

export const idb = {
  get: <T>(store: StoreName, key: string) => tx<T>(store, 'readonly', s => s.get(key) as IDBRequest<T>),
  put: (store: StoreName, key: string, value: unknown) => tx(store, 'readwrite', s => s.put(value, key)),
  del: (store: StoreName, key: string) => tx(store, 'readwrite', s => s.delete(key)),
  keys: (store: StoreName) => tx<IDBValidKey[]>(store, 'readonly', s => s.getAllKeys()),
  getAll: <T>(store: StoreName) => tx<T[]>(store, 'readonly', s => s.getAll() as IDBRequest<T[]>),
};
