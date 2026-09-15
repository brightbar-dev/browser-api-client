/**
 * A tiny IndexedDB key-value store for bytes that don't belong in storage.local:
 * files attached to request bodies, and the last response of each open tab.
 */

const DB_NAME = 'browser-api-client';
const DB_VERSION = 1;
export type StoreName = 'files' | 'responses';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['files', 'responses']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  return run<T | undefined>(store, 'readonly', s => s.get(key));
}

export function idbPut(store: StoreName, key: string, value: unknown): Promise<void> {
  return run<void>(store, 'readwrite', s => s.put(value, key)).then(() => undefined);
}

export function idbDelete(store: StoreName, key: string): Promise<void> {
  return run<void>(store, 'readwrite', s => s.delete(key)).then(() => undefined);
}

export function idbKeys(store: StoreName): Promise<string[]> {
  return run<IDBValidKey[]>(store, 'readonly', s => s.getAllKeys()).then(keys => keys.map(String));
}
