import { decodeGif, gifFrameAt, renderGifFrame, type GifAnimation } from '../src/shared/gif-timeline';
import { GIF_LIMITS } from '../src/shared/gif-bounds';

/** Manual local composition probe; inputs never leave the browser. */
export function mountGifProbe(host: HTMLElement, surface: HTMLElement) {
  const controls = document.createElement('section');
  controls.innerHTML = `<label>GIF files (up to three) <input type="file" accept="image/gif" multiple></label>
<button type="button">Play GIFs</button><label>GIF time (ms) <input type="number" value="0" min="0" max="60000"></label><output aria-live="polite"></output>`;
  host.appendChild(controls);
  const file = controls.querySelector('input[type=file]') as HTMLInputElement;
  const time = controls.querySelector('input[type=number]') as HTMLInputElement;
  const button = controls.querySelector('button')!, message = controls.querySelector('output')!;
  let items: { animation: GifAnimation; canvas: HTMLCanvasElement; frame: number }[] = [];
  let playing = false, frameId = 0, origin = 0, loadGeneration = 0;
  const stop = () => { playing = false; cancelAnimationFrame(frameId); button.textContent = 'Play GIFs'; };
  const timelineTime = () => {
    const entered = time.valueAsNumber;
    const value = Number.isFinite(entered) ? Math.max(0, Math.min(60000, entered)) : 0;
    if (!Number.isFinite(entered) || value !== entered) {
      time.value = String(value);
      message.textContent = `Invalid GIF time; use 0–60000 ms. Reset to ${value} ms.`;
    }
    return value;
  };
  const render = () => {
    const timeMs = timelineTime();
    for (const item of items) {
      const frame = gifFrameAt(item.animation, { timeMs, loop: true });
      if (frame === item.frame) continue;
      const pixels = new ImageData(new Uint8ClampedArray(renderGifFrame(item.animation, frame)), item.animation.width, item.animation.height);
      item.canvas.getContext('2d')!.putImageData(pixels, 0, 0); item.frame = frame;
    }
  };
  const tick = (now: number) => { if (!playing) return; time.value = String(Math.floor(now - origin) % 60000); render(); frameId = requestAnimationFrame(tick); };
  button.onclick = () => {
    if (playing) { stop(); return; }
    if (!items.length) return;
    playing = true; origin = performance.now() - timelineTime(); button.textContent = 'Pause GIFs'; frameId = requestAnimationFrame(tick);
  };
  time.oninput = () => { stop(); message.textContent = ''; render(); };
  file.onchange = async () => {
    stop(); const generation = ++loadGeneration;
    try {
      const files = [...file.files ?? []];
      if (files.length > 3 || files.some(f => f.size > 2 * 1024 ** 2)) throw new Error('Use at most three GIFs, each no larger than 2 MiB');
      const next = [];
      for (let index = 0; index < files.length; index++) {
        const bytes = new Uint8Array(await files[index].arrayBuffer());
        if (generation !== loadGeneration) return;
        const animation = decodeGif(bytes, { ...GIF_LIMITS, maxSourceBytes: 2 * 1024 ** 2, maxCanvasPixels: 1024 ** 2, maxPatchPixels: 2 * 1024 ** 2, maxWorkingBytes: 32 * 1024 ** 2 });
        const canvas = document.createElement('canvas'); canvas.width = animation.width; canvas.height = animation.height;
        canvas.style.cssText = `position:absolute;left:${index * 100}px;top:${170 + index * 20}px;width:180px;height:100px;pointer-events:none;image-rendering:pixelated;clip-path:inset(0 0 0 0 round 8px)`;
        canvas.setAttribute('aria-label', `GIF ${index + 1}`); next.push({ animation, canvas, frame: -1 });
      }
      items.forEach(item => item.canvas.remove()); items = next;
      items.forEach(item => surface.insertBefore(item.canvas, surface.querySelector('svg')));
      time.value = '0'; render(); message.textContent = `${items.length} GIFs loaded locally`;
    } catch (error) { if (generation === loadGeneration) message.textContent = error instanceof Error ? error.message : 'GIF failed'; }
  };
  window.addEventListener('blur', stop);
}
