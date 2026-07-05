/* Minimal IndexedDB wrapper. Stores: vectors (semantic search), audio (recordings). */

const DB_NAME = 'meetingghost';
const DB_VERSION = 1;
const STORES = ['vectors', 'audio'] as const;
export type StoreName = typeof STORES[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!req.result.objectStoreNames.contains(name)) {
          req.result.createObjectStore(name);
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = op(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export const idb = {
  get: <T>(store: StoreName, key: string) => tx<T>(store, 'readonly', s => s.get(key) as IDBRequest<T>),
  put: (store: StoreName, key: string, value: unknown) => tx(store, 'readwrite', s => s.put(value, key)),
  del: (store: StoreName, key: string) => tx(store, 'readwrite', s => s.delete(key)),
  keys: (store: StoreName) => tx<IDBValidKey[]>(store, 'readonly', s => s.getAllKeys()),
  getAll: <T>(store: StoreName) => tx<T[]>(store, 'readonly', s => s.getAll() as IDBRequest<T[]>),
};
