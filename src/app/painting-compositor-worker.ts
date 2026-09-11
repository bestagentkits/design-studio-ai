import { compositePainting } from '../shared/paint-composite';
import type { Painting } from '../shared/painting-schema';
const pending = new Map<number, { resolve: (pixels: Uint8Array) => void; reject: (error: Error) => void }>();
let sequence = 0;
self.onmessage = (event: MessageEvent<{ painting?: Painting; request?: number; pixels?: Uint8Array; error?: string }>) => {
  const message = event.data;
  if (message.request !== undefined) { const task = pending.get(message.request); pending.delete(message.request); if (message.error) task?.reject(new Error(message.error)); else if (message.pixels) task?.resolve(message.pixels); return; }
  if (!message.painting) return;
  void compositePainting(message.painting, (assetId, hash) => new Promise((resolve, reject) => {
    const request = ++sequence; pending.set(request, { resolve, reject }); self.postMessage({ request, assetId, hash });
  })).then(pixels => self.postMessage({ pixels }, { transfer: [pixels.buffer] })).catch(error => self.postMessage({ error: String(error) }));
};
