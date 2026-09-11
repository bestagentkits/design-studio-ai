import { compositePainting } from '../shared/paint-composite';
import type { Painting } from '../shared/painting-schema';
/** Browser compositor keeps pixel loops off the interaction thread; unsupported runtimes use the same trusted math. */
export async function compositePaintingInBrowser(painting: Painting, load: (id: string, hash: string) => Promise<Uint8Array>, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Painting compositor cancelled');
  if (typeof Worker === 'undefined') return compositePainting(painting, load);
  let worker: Worker;
  try { worker = new Worker(new URL('./painting-compositor-worker.ts', import.meta.url), { type: 'module' }); }
  catch { return compositePainting(painting, load); }
  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;
    const abort = () => { if (!settled) { finish(); reject(new Error('Painting compositor cancelled')); } };
    const finish = () => { settled = true; signal?.removeEventListener('abort', abort); worker.terminate(); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { if (settled) return; finish(); void compositePainting(painting, load).then(resolve, reject); };
    worker.onmessage = (event: MessageEvent<{ request?: number; assetId?: string; hash?: string; pixels?: Uint8Array; error?: string }>) => {
      const message = event.data;
      if (message.request !== undefined) {
        void load(message.assetId!, message.hash!).then(pixels => { if (!settled) { const copy = pixels.slice(); worker.postMessage({ request: message.request, pixels: copy }, [copy.buffer]); } }).catch(error => { if (!settled) worker.postMessage({ request: message.request, error: String(error) }); }); return;
      }
      finish(); if (message.error) reject(new Error(message.error)); else if (message.pixels) resolve(message.pixels); else reject(new Error('Invalid compositor response'));
    };
    worker.postMessage({ painting });
  });
}
