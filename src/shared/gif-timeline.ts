import { decompressFrame, parseGIF } from 'gifuct-js';
import { GIF_LIMITS, inspectGif, type GifFrameHeader, type GifLimits } from './gif-bounds';

export type GifAnimation = {
  original: Uint8Array; width: number; height: number; durationMs: number; repeat: number | null; background: number[];
  frames: (GifFrameHeader & { rgba: Uint8ClampedArray })[];
};

/** Retain original GIF bytes; patches are derived cache data, never the saved source asset. */
export function decodeGif(input: Uint8Array, limits: GifLimits = GIF_LIMITS): GifAnimation {
  const header = inspectGif(input, limits);
  const original = new Uint8Array(input);
  const parsed = parseGIF(original.buffer);
  const images = parsed.frames.filter((frame): frame is Parameters<typeof decompressFrame>[0] => 'image' in frame);
  if (images.length !== header.frames.length) throw new Error('GIF parser frame count mismatch');
  const frames = images.map((image, i) => {
    const frame = decompressFrame(image, parsed.gct, true), meta = header.frames[i];
    if (frame.patch.length !== meta.width * meta.height * 4 || frame.pixels.some(index => !frame.colorTable[index])) throw new Error('Invalid GIF decoded pixels');
    // Valid extensions can separate a GCE from its image; parser grouping is not authoritative.
    frame.pixels.forEach((color, pixel) => { frame.patch[pixel * 4 + 3] = meta.transparent && color === meta.transparentIndex ? 0 : 255; });
    return { ...meta, rgba: frame.patch };
  });
  return { ...header, original, frames, durationMs: frames.reduce((sum, frame) => sum + frame.delayMs, 0) };
}

/** pausedAtMs is animation-local elapsed time, independent of the document timeline start. */
export type GifPlayback = { timeMs: number; startMs?: number; paused?: boolean; pausedAtMs?: number; posterFrame?: number; loop?: boolean };

export function gifFrameAt(animation: GifAnimation, playback: GifPlayback): number {
  const { timeMs, startMs = 0, paused = false, pausedAtMs = 0, posterFrame = 0, loop } = playback;
  if (![timeMs, startMs, pausedAtMs].every(Number.isFinite) || !Number.isInteger(posterFrame) || posterFrame < 0 || posterFrame >= animation.frames.length) throw new Error('Invalid GIF timeline position');
  if (paused || timeMs < startMs) return paused ? gifFrameAt(animation, { timeMs: pausedAtMs, loop, posterFrame }) : posterFrame;
  const elapsed = Math.max(0, timeMs - startMs);
  const cycles = loop === true || loop === undefined && animation.repeat === 0 ? Infinity : loop === false || animation.repeat === null ? 1 : animation.repeat + 1;
  if (elapsed >= animation.durationMs * cycles) return animation.frames.length - 1;
  let position = elapsed % animation.durationMs;
  for (let i = 0; i < animation.frames.length; i++) { if (position < animation.frames[i].delayMs) return i; position -= animation.frames[i].delayMs; }
  return animation.frames.length - 1;
}

/** Deterministic RGBA selected-time rendering with no wall-clock-dependent HTMLImageElement. */
export function renderGifFrame(animation: GifAnimation, index: number): Uint8ClampedArray {
  if (!Number.isInteger(index) || index < 0 || index >= animation.frames.length) throw new Error('Invalid GIF frame index');
  const canvas = new Uint8ClampedArray(animation.width * animation.height * 4);
  const fill = (frame: GifFrameHeader, color: number[]) => {
    for (let y = frame.top; y < frame.top + frame.height; y++) for (let x = frame.left; x < frame.left + frame.width; x++) canvas.set(color, (y * animation.width + x) * 4);
  };
  if (!animation.frames[0].transparent) fill({ left: 0, top: 0, width: animation.width, height: animation.height } as GifFrameHeader, animation.background);
  for (let i = 0; i <= index; i++) {
    const frame = animation.frames[i];
    const previous = frame.disposal === 3 && i < index ? canvas.slice() : null;
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
      const source = (y * frame.width + x) * 4;
      if (frame.rgba[source + 3]) canvas.set(frame.rgba.subarray(source, source + 4), ((frame.top + y) * animation.width + frame.left + x) * 4);
    }
    if (i === index) break;
    if (frame.disposal === 2) fill(frame, frame.transparent ? [0, 0, 0, 0] : animation.background);
    else if (previous) canvas.set(previous);
  }
  return canvas;
}
