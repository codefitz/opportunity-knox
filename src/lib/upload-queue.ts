export const uploadId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
import type { DroppedFile } from "../api";
export type UploadOptions = {
  kind: string;
  status: string;
  notes: string;
  category: string;
  batchUploads: boolean;
};
export type QueuedUpload = DroppedFile & {
  id: string;
  scope: string;
  createdAt: number;
  attempt?: UploadOptions;
  error?: string;
};
const DB = "opportunity-knox-upload-queue";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      const s = db.createObjectStore("files", { keyPath: "id" });
      s.createIndex("scope", "scope");
      db.createObjectStore("queues", { keyPath: "scope" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(
        Error("Another tab is blocking the upload queue. Close it and retry."),
      );
  });
}
export async function queueStore<T>(
  scope: string,
  write: boolean,
  work: (
    files: IDBObjectStore,
    queues: IDBObjectStore,
    done: (result: T) => void,
  ) => void,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      ["files", "queues"],
      write ? "readwrite" : "readonly",
    );
    let result: T;
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onabort = () => {
      db.close();
      reject(
        tx.error ||
          Error(
            "The browser could not save the upload queue. Check available storage.",
          ),
      );
    };
    tx.onerror = () => {};
    try {
      work(tx.objectStore("files"), tx.objectStore("queues"), (value) => {
        result = value;
      });
    } catch (e) {
      tx.abort();
      db.close();
      reject(e);
    }
  });
}
const requested = <T>(r: IDBRequest<T>, done: (v: T) => void) => {
  r.onsuccess = () => done(r.result);
};
function unlocked(q: any, owner: string) {
  if (q?.lease?.owner !== owner && q?.lease?.until > Date.now())
    throw Error(
      "Another tab is uploading this queue. Pause it, or wait up to 30 seconds after closing it.",
    );
}
export const uploadQueue = {
  async load(scope: string) {
    return queueStore<{ files: QueuedUpload[]; options?: UploadOptions }>(
      scope,
      false,
      (f, q, done) =>
        requested(f.index("scope").getAll(scope), (files) =>
          requested(q.get(scope), (queue) =>
            done({
              files: files.sort(
                (a, b) =>
                  Number(!!a.error) - Number(!!b.error) ||
                  a.createdAt - b.createdAt,
              ),
              options: queue?.options,
            }),
          ),
        ),
    );
  },
  async add(scope: string, incoming: DroppedFile[]) {
    for (const i of incoming)
      if (i.file.size > 15 * 1024 * 1024)
        throw Error(
          `${i.path} exceeds the 15 MB file limit. No selected files were queued.`,
        );
    return queueStore(scope, true, (f, q, done) =>
      requested(q.get(scope), (queue) => {
        try {
          unlocked(queue, "");
        } catch {
          f.transaction.abort();
          return;
        }
        requested(f.index("scope").getAll(scope), (existing) => {
          const paths = new Set(existing.map((i) => i.path));
          let count = 0;
          for (const item of incoming)
            if (!paths.has(item.path)) {
              paths.add(item.path);
              f.add({
                ...item,
                id: uploadId(),
                scope,
                createdAt: Date.now() + count++ / 1000,
              });
            }
          done(count);
        });
      }),
    );
  },
  async options(scope: string, options: UploadOptions) {
    return queueStore(scope, true, (_f, q, done) =>
      requested(q.get(scope), (existing) => {
        q.put({ ...existing, scope, options });
        done(true);
      }),
    );
  },
  async lease(scope: string, owner: string, release = false) {
    return queueStore(scope, true, (_f, q, done) =>
      requested(q.get(scope), (existing) => {
        try {
          unlocked(existing, owner);
        } catch {
          q.transaction.abort();
          return;
        }
        q.put({
          ...existing,
          scope,
          lease: release ? null : { owner, until: Date.now() + 30000 },
        });
        done(true);
      }),
    );
  },
  async attempt(
    scope: string,
    id: string,
    owner: string,
    options: UploadOptions,
  ) {
    return queueStore<QueuedUpload>(scope, true, (f, q, done) =>
      requested(q.get(scope), (queue) => {
        if (queue?.lease?.owner !== owner || queue.lease.until < Date.now()) {
          f.transaction.abort();
          return;
        }
        requested(f.get(id), (item) => {
          if (!item || item.scope !== scope) {
            f.transaction.abort();
            return;
          }
          item.attempt ||= options;
          f.put(item);
          done(item);
        });
      }),
    );
  },
  async remove(scope: string, ids: string[] | null, owner = "") {
    return queueStore(scope, true, (f, q, done) =>
      requested(q.get(scope), (queue) => {
        try {
          unlocked(queue, owner);
        } catch {
          f.transaction.abort();
          return;
        }
        requested(f.index("scope").getAll(scope), (items) => {
          for (const item of items)
            if (!ids || ids.includes(item.id)) f.delete(item.id);
          done(true);
        });
      }),
    );
  },
  async failed(scope: string, id: string, error: string) {
    return queueStore(scope, true, (f, _q, done) =>
      requested(f.get(id), (item) => {
        if (item?.scope === scope)
          f.put({ ...item, error: error.slice(0, 1000) });
        done(true);
      }),
    );
  },
};
