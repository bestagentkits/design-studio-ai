import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ELEMENT_LIBRARY, EMOJI_SKIN_VARIANTS, elementArtwork, searchElements, artworkUrl, ELEMENT_ARTWORK_LICENSE } from '../src/shared/creative-elements-catalog';
import { decodeGif, gifFrameAt, renderGifFrame } from '../src/shared/gif-timeline';
import { gif } from './helpers/gif-fixture';

test('local artwork searches names, semantic Unicode and keywords without external resources', () => {
  assert.equal(searchElements('nature')[0].id, 'leaf');
  assert.equal(searchElements('👍')[0].id, 'thumb');
  assert.equal(searchElements('celebration award')[0].id, 'star');
  assert.equal(searchElements('nonexistent').length, 0);
  assert.match(ELEMENT_ARTWORK_LICENSE, /MIT/);
  for (const item of ELEMENT_LIBRARY) {
    const svg = elementArtwork(item);
    assert.match(svg, /<svg/); assert.doesNotMatch(svg, /<text|<script|<image|https:\/\//);
    assert.equal(decodeURIComponent(artworkUrl(item).split(',')[1]), svg);
  }
});
test('hand variants retain deterministic selected artwork and bounded color choices', () => {
  const thumb = ELEMENT_LIBRARY.find(e => e.id === 'thumb')!;
  assert.equal(new Set(EMOJI_SKIN_VARIANTS.map((v, i) => elementArtwork(thumb, '#123456', i))).size, 6);
  assert.throws(() => elementArtwork(thumb, 'red" onload="alert(1)'));
  assert.throws(() => elementArtwork(thumb, '#123456', 8));
  const star = ELEMENT_LIBRARY[0]; assert.match(elementArtwork(star, '#123456'), /fill="#123456"/);
});
test('real GIF playback samples transparent disposal, loop and exact paused elapsed time', () => {
  const animation = decodeGif(gif(0));
  const first = renderGifFrame(animation, gifFrameAt(animation, { timeMs: 0 }));
  const second = renderGifFrame(animation, gifFrameAt(animation, { timeMs: 20 }));
  assert.notDeepEqual(first, second);
  assert.deepEqual(renderGifFrame(animation, 2).slice(0, 4), first.slice(0, 4));
  assert.equal(gifFrameAt(animation, { timeMs: 10000, paused: true, pausedAtMs: 20 }), 1);
  assert.equal(gifFrameAt(animation, { timeMs: 1, startMs: 500, posterFrame: 2 }), 2);
  assert.equal(gifFrameAt(animation, { timeMs: 10000, loop: false }), 3);
  assert.deepEqual(animation.original, gif(0));
});

test('raster preflight bounds dimensions before decode and rejects unsupported headers', async () => {
  const { inspectElementImage } = await import('../src/shared/creative-elements-image-bounds');
  const png = new Uint8Array(24); png.set([137, 80, 78, 71]); png.set([73, 72, 68, 82], 12);
  const view = new DataView(png.buffer); view.setUint32(16, 128); view.setUint32(20, 64);
  assert.deepEqual(inspectElementImage(png, 'image/png'), { width: 128, height: 64 });
  view.setUint32(16, 5000); assert.throws(() => inspectElementImage(png, 'image/png'), /dimensions exceed/);
  assert.throws(() => inspectElementImage(new Uint8Array(20), 'image/jpeg'), /malformed/);
  const webp = new Uint8Array(30); webp.set(Buffer.from('RIFF')); webp.set(Buffer.from('WEBPVP8X'), 8); webp[20] = 2;
  assert.throws(() => inspectElementImage(webp, 'image/webp'), /Animated WebP/);
  const { GIF_LIMITS } = await import('../src/shared/gif-bounds');
  assert.throws(() => decodeGif(gif(), { ...GIF_LIMITS, maxDurationMs: 30 }), /duration/);
});
