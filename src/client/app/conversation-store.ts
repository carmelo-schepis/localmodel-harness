export type LocalAttachment = {
  id: string;
  projectId: string;
  name: string;
  mime: string;
  size: number;
  blob?: Blob;
  messageId?: string;
  prompt: string;
  submittedAt: string;
};

export type ForkSnapshot = {
  projectId: string;
  sourceProjectId: string;
  sourceName: string;
  forkMessageId: string;
  messages: Array<{ id?: string; role: string; content: string; model?: string; created_at?: string }>;
};

type Stored = { key: string; value: unknown };
const DB_NAME = 'local-harness-chat';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local chat storage.'));
  });
}

async function read<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('records').objectStore('records').get(key) as IDBRequest<Stored | undefined>;
    request.onsuccess = () => { db.close(); resolve(request.result?.value as T | undefined); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function saveAttachment(record: LocalAttachment): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    const store = tx.objectStore('records');
    const key = `attachments:${record.projectId}`;
    const request = store.get(key) as IDBRequest<Stored | undefined>;
    request.onsuccess = () => {
      const previous = request.result?.value as LocalAttachment[] | undefined;
      const next = (previous ?? []).filter(item => item.id !== record.id);
      next.push(record);
      store.put({ key, value: next } satisfies Stored);
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Could not save this image in browser storage.')); };
  });
}

export async function getAttachments(projectId: string): Promise<LocalAttachment[]> {
  return await read<LocalAttachment[]>(`attachments:${projectId}`) ?? [];
}

export async function removeAttachment(projectId: string, id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    const store = tx.objectStore('records');
    const key = `attachments:${projectId}`;
    const request = store.get(key) as IDBRequest<Stored | undefined>;
    request.onsuccess = () => {
      const previous = request.result?.value as LocalAttachment[] | undefined;
      store.put({ key, value: (previous ?? []).filter(item => item.id !== id) } satisfies Stored);
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Could not remove this local image.')); };
  });
}

export async function saveForkWithAttachments(snapshot: ForkSnapshot, attachments: LocalAttachment[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    const store = tx.objectStore('records');
    store.put({ key: `fork:${snapshot.projectId}`, value: snapshot } satisfies Stored);
    store.put({ key: `attachments:${snapshot.projectId}`, value: attachments } satisfies Stored);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Could not save the fork in this browser.')); };
  });
}

export async function getFork(projectId: string): Promise<ForkSnapshot | undefined> {
  return read<ForkSnapshot>(`fork:${projectId}`);
}
