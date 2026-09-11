import type { DesignDocument } from '../shared/schema';
export interface BoardDraft { key: string; account: string; project: string; board: string; base: DesignDocument; document: DesignDocument }
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('design-studio-board-drafts', 1); r.onupgradeneeded = () => r.result.createObjectStore('drafts', { keyPath: 'key' }); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
export const boardDraftKey = (account: string, project: string, board: string) => JSON.stringify([account, project, board]);
export async function readBoardDraft(key: string): Promise<BoardDraft | undefined> {
  const db = await database(); try { return await new Promise((resolve,reject) => { const r=db.transaction('drafts').objectStore('drafts').get(key); r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); }); } finally { db.close(); }
}
export async function writeBoardDraft(draft: BoardDraft) {
  const db = await database(); try { await new Promise<void>((resolve,reject) => { const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(draft);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error); }); } finally { db.close(); }
}
export async function deleteBoardDraft(key: string) {
  const db = await database(); try { await new Promise<void>((resolve,reject) => { const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error); }); } finally { db.close(); }
}
