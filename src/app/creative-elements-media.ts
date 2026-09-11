import { api } from './api';
import type { AssetRef } from '../shared/schema';
import { gifFrameAt, renderGifFrame, type GifAnimation } from '../shared/gif-timeline';
export { loadGifAsset } from './creative-elements-gif-loader';
export async function uploadElementAsset(projectId: string, blob: Blob, name: string): Promise<AssetRef> {
  const form = new FormData(); form.append('file', blob, name);
  return (await api<{ asset: AssetRef }>(`/api/projects/${projectId}/assets`, { method: 'POST', body: form })).asset;
}
export function gifPosterCanvas(animation: GifAnimation, timeMs: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = animation.width; canvas.height = animation.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(renderGifFrame(animation, gifFrameAt(animation, { timeMs, loop: false }))), animation.width, animation.height), 0, 0);
  return canvas;
}
export async function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode image')), 'image/png'));
}
