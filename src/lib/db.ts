import type { DiaryCache, Entry } from "../types.ts";

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("one-line", 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore("entries", { keyPath: "id" });
        db.createObjectStore("diary", { keyPath: "day" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const loadEntries = () => tx<Entry[]>("entries", "readonly", (s) => s.getAll());
export const saveEntry = (e: Entry) => tx("entries", "readwrite", (s) => s.put(e)).then(() => undefined);
export const removeEntry = (id: string) => tx("entries", "readwrite", (s) => s.delete(id)).then(() => undefined);
export const loadDiary = (day: string) => tx<DiaryCache | undefined>("diary", "readonly", (s) => s.get(day));
export const saveDiary = (d: DiaryCache) => tx("diary", "readwrite", (s) => s.put(d)).then(() => undefined);
export const loadAllDiaries = () => tx<DiaryCache[]>("diary", "readonly", (s) => s.getAll());
