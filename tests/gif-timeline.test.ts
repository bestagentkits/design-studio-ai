import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeGif, gifFrameAt, renderGifFrame } from '../src/shared/gif-timeline';
import { GIF_LIMITS, inspectGif } from '../src/shared/gif-bounds';

import { gif } from './helpers/gif-fixture';

const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255], clear = [0, 0, 0, 0];

test('comments cannot detach transparency and extension object counts stay bounded', () => {
  const source = gif(), pattern = Buffer.from([0x2c, 0, 0, 0, 0, 2, 0, 1, 0, 0, 2]);
  const first = Buffer.from(source).indexOf(pattern), second = Buffer.from(source).indexOf(pattern, first + 1);
  assert.ok(second > first);
  const comments = [0x21, 0xfe, 1, 65, 0, 0x21, 0xfe, 1, 66, 0];
  const withComments = Uint8Array.from([...source.subarray(0, second), ...comments, ...source.subarray(second)]);
  assert.deepEqual(renderGifFrame(decodeGif(withComments), 1), renderGifFrame(decodeGif(source), 1));
  assert.throws(() => decodeGif(withComments, { ...GIF_LIMITS, maxBlocks: 3 }), /block count/);
  assert.throws(() => decodeGif(withComments, { ...GIF_LIMITS, maxSubBlocks: 2 }), /sub-block/);
});

test('real GIF bytes preserve original source and composite transparency/disposal 1, 2, 3', () => {
  const source = gif(), untouched = source.slice(), animation = decodeGif(source);
  assert.deepEqual(animation.original, untouched);
  source[0] = 0;
  assert.deepEqual(animation.original, untouched);
  assert.deepEqual(animation.frames.map(frame => frame.delayMs), [20, 30, 40, 50]);
  assert.deepEqual(Array.from(renderGifFrame(animation, 0)), [...red, ...red]);
  assert.deepEqual(Array.from(renderGifFrame(animation, 1)), [...green, ...red]);
  assert.deepEqual(Array.from(renderGifFrame(animation, 2)), [...red, ...blue]);
  assert.deepEqual(Array.from(renderGifFrame(animation, 3)), [...green, ...clear]);
  assert.deepEqual(Array.from(renderGifFrame(animation, 1)), [...green, ...red], 'out-of-order seeks are deterministic');
});

test('timeline honors exact boundaries, finite/infinite loops, pause, start and poster', () => {
  const animation = decodeGif(gif());
  assert.equal(animation.durationMs, 140);
  for (const [timeMs, frame] of [[0, 0], [19, 0], [20, 1], [49, 1], [50, 2], [90, 3], [140, 0], [160, 1], [280, 3]]) assert.equal(gifFrameAt(animation, { timeMs }), frame);
  assert.equal(gifFrameAt(animation, { timeMs: 0, startMs: 100, posterFrame: 2 }), 2);
  assert.equal(gifFrameAt(animation, { timeMs: 10000, paused: true, pausedAtMs: 20 }), 1);
  assert.equal(gifFrameAt(animation, { timeMs: 300, loop: true }), 1);
  assert.equal(gifFrameAt(animation, { timeMs: 160, loop: false }), 3);
  assert.equal(gifFrameAt(decodeGif(gif(0)), { timeMs: 300 }), 1);
  assert.equal(gifFrameAt(decodeGif(gif(null)), { timeMs: 160 }), 3);
  assert.throws(() => gifFrameAt(animation, { timeMs: NaN }), /Invalid/);
  assert.throws(() => renderGifFrame(animation, 4), /Invalid/);
});

test('preflight rejects decode work before decompression for oversized and truncated inputs', () => {
  const source = gif();
  assert.throws(() => decodeGif(source, { ...GIF_LIMITS, maxSourceBytes: 10 }), /source byte/);
  assert.throws(() => decodeGif(source, { ...GIF_LIMITS, maxCanvasPixels: 1 }), /canvas pixel/);
  assert.throws(() => decodeGif(source, { ...GIF_LIMITS, maxFrames: 3 }), /frame\/decode/);
  assert.throws(() => decodeGif(source, { ...GIF_LIMITS, maxPatchPixels: 3 }), /frame\/decode/);
  assert.throws(() => decodeGif(source, { ...GIF_LIMITS, maxWorkingBytes: 1 }), /memory/);
  assert.throws(() => inspectGif(source.subarray(0, source.length - 1)), /trailer/);
  assert.throws(() => inspectGif(source.subarray(0, 50)), /Truncated/);
  const badDimensions = source.slice(); badDimensions[6] = 255; badDimensions[7] = 255;
  assert.throws(() => inspectGif(badDimensions, { ...GIF_LIMITS, maxCanvasPixels: 100 }), /canvas pixel/);
  const invalidLzw = source.slice();
  const image = invalidLzw.indexOf(0x2c); invalidLzw[image + 12] = 0x2c; // clear, then EOI before any pixels
  assert.throws(() => decodeGif(invalidLzw), /pixel count/);
});

// Encoded independently with released MIT gifenc 1.0.3, 32x32 xorshift palette
// pixels. This exercises dictionary growth beyond the clear-per-pixel writer.
test('external encoder GIF decodes dictionary growth', () => {
  const bytes = Buffer.from('R0lGODlhIAAgAPMAAAD/ABHuByLdDjPMFUS7HFWqI2aZKneIMYh3OJlmP6pVRrtETcwzVN0iW+4RYv8AaSH/C05FVFNDQVBFMi4wAwEAAAAh+QQABQAAACwAAAAAIAAgAAAI/gARMBgAgIABBA4GHFAwgACABAkKDhCQoKECBA8IPGjQQMBFBwEQFFCQAIFBkQwWPDiw4ACBAgAQqEzQgIGDlwIaBABQQGPFBAYECGCQgIDNAgwYPlAogKeDBUAPFFgwFMCABQqQJjggQKQDhgAeKFAQwICBBVcdJHDAU8BOBw0IILA6QAGABQgaOChQwMAAvVsRBDjggIGBAg8SbLR6IKqAlgACVAzwFwCDAwEeCDCA+W/cBguhCgwQF8HEBQvkJkywoCdajg0EGwTgUQABkAUGGCBdYG3FBgMiKiDamIHDgnktHzgwAOPtuHwTBBjJOsHwigYAxAUA4IDMrweO/jYogEDBA9IC9QZwu8CAgrMLAmDlXGD5+rAMMiYgj5mqAaMOJJSbArdVZJlddRXQgAI3NWDARubplpVDDv2nVlwE5OQAAgIQxEB6DwyE1EQdBlCWbVYpSJRJGgk0l1HDpRYTcylVxJVLBPwWlgIL5OfQggXAteCMC230AABqiSXAAeMx4FaIEB1ggAOdSYVYcA8cZNBVZUm5XY7ePSBTiGWppYBL8sHUwEbkRSkAUvE9gJRlTyEgmHQNIrBbZCmRxZJY1qUmpZyXPSYUAQ3VJMADD2ClFwDmQbVXlsYZoJNqvLUkGUHlkYURbSbK1pFHgu201JJfacbWADe5ZN5y63oNJxBnBjh5llQHZPTeAtw58CYBDqamW4ZdneddA6lZygCScV2kEmm6ObBbAwD8ZxdaBLVEnpwk0QQSRDNu5OFerBIALAFoTTYcYiM5aVOAQUJEVWqI6sZTUGjRRhFGrGnX3kADkDYQVxu1tCZQpqFFUks21WQSozdJu1yPJC3anYLy0ZaXA0uZRdJsGDG3X2+LInZbSggwWSRMQHUYnkcLPgZcAMuKZFJvSMqFLEZdhbcRaZkh2tFFIekZcEh4XcSaeVkFUFhmQT24XIhK7kWZZQtIu19GyHZnKWWNBm1aStytVxhDQwHFQEAAOw==', 'base64');
  const animation = decodeGif(bytes);
  const rgba = renderGifFrame(animation, 0);
  let seed = 42;
  for (let i = 0; i < 1024; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; const color = seed & 15;
    assert.deepEqual(Array.from(rgba.subarray(i * 4, i * 4 + 4)), [color * 17, 255 - color * 17, color * 7, 255]);
  }
});

test('local palettes, zero delay policy and opaque background disposal are explicit', () => {
  const source = gif();
  const image = source.indexOf(0x2c);
  const withLocalPalette = Uint8Array.from([...source.subarray(0, image + 10), ...source.subarray(13, 25), ...source.subarray(image + 10)]);
  withLocalPalette[image + 9] = 0x81;
  assert.deepEqual(renderGifFrame(decodeGif(withLocalPalette), 1), renderGifFrame(decodeGif(source), 1));
  const zeroDelay = source.slice(); const gce = Buffer.from(zeroDelay).indexOf(Buffer.from([0x21, 0xf9, 4]));
  zeroDelay[gce + 4] = 0;
  assert.equal(decodeGif(zeroDelay).frames[0].delayMs, 100);
  const opaque = source.slice(); const control = Buffer.from(opaque).indexOf(Buffer.from([0x21, 0xf9, 4, 9]));
  opaque[control + 3] = 8;
  assert.deepEqual(Array.from(renderGifFrame(decodeGif(opaque), 3)), [...green, 0, 0, 0, 255]);
});
