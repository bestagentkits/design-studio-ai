import type { DesignDocument } from '../shared/schema';
import type { Painting } from '../shared/painting-schema';
export interface StoredPaintingDraft { key: string; accountId: string; projectId: string; paintingId: string; base: DesignDocument; painting: Painting; layerId: string; editMask?: boolean; settings?: Painting; tiles?: [string, Uint8Array][]; prepared?: DesignDocument }
export const paintingDraftKey = (account: string, project: string, painting: string) => JSON.stringify([account, project, painting]);
async function database(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new Error('Durable draft storage is unavailable in this browser. Keep this window open or download a backup.');
  return new Promise((resolve, reject) => { const request = indexedDB.open('design-studio-paint-drafts', 1); request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
export async function readPaintingDraft(account: string, project: string, painting: string): Promise<StoredPaintingDraft | undefined> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const request = db.transaction('drafts').objectStore('drafts').get(paintingDraftKey(account, project, painting)); request.onsuccess = () => { const draft = request.result as StoredPaintingDraft | undefined; if (draft && (draft.accountId !== account || draft.projectId !== project || draft.paintingId !== painting || draft.base.id !== project)) reject(new Error('Painting recovery account or project mismatch.')); else resolve(draft); }; request.onerror = () => reject(request.error); }); } finally { db.close(); }
}
export async function writePaintingDraft(draft: StoredPaintingDraft) {
  const db = await database(); try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put(draft); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); } finally { db.close(); }
}
export async function deletePaintingDraft(key: string) {
  const db = await database(); try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').delete(key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); } finally { db.close(); }
}
