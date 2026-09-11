export type GifLimits = { maxSourceBytes: number; maxCanvasPixels: number; maxFrames: number; maxPatchPixels: number; maxWorkingBytes: number; maxBlocks: number; maxSubBlocks: number; maxDurationMs: number };
export const GIF_LIMITS: GifLimits = { maxSourceBytes: 20 * 1024 ** 2, maxCanvasPixels: 4096 ** 2, maxFrames: 300, maxPatchPixels: 32 * 1024 ** 2, maxWorkingBytes: 256 * 1024 ** 2, maxBlocks: 2048, maxSubBlocks: 65536, maxDurationMs: 600000 };
export type GifFrameHeader = { left: number; top: number; width: number; height: number; delayMs: number; disposal: number; transparent: boolean; transparentIndex: number };
export type GifHeader = { width: number; height: number; frames: GifFrameHeader[]; repeat: number | null; background: number[] };

/** Scan every block before the third-party parser allocates/decompresses frame pixels. */
export function inspectGif(bytes: Uint8Array, limits: GifLimits = GIF_LIMITS): GifHeader {
  if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value <= 0)) throw new Error('Invalid GIF resource limits');
  if (bytes.length > limits.maxSourceBytes) throw new Error('GIF source byte budget exceeded');
  let p = 0;
  let blockCount = 0, subBlockCount = 0;
  const take = (n: number) => { if (p + n > bytes.length) throw new Error('Truncated GIF block'); const part = bytes.subarray(p, p + n); p += n; return part; };
  const byte = () => take(1)[0];
  const word = () => { const b = take(2); return b[0] | b[1] << 8; };
  const blocks = () => {
    const parts: Uint8Array[] = [];
    for (let n = byte(); n; n = byte()) {
      if (++subBlockCount > limits.maxSubBlocks || bytes.length * 4 + subBlockCount * 128 > limits.maxWorkingBytes) throw new Error('GIF sub-block memory budget exceeded');
      parts.push(take(n));
    }
    return parts;
  };
  const signature = String.fromCharCode(...take(6));
  if (signature !== 'GIF89a' && signature !== 'GIF87a') throw new Error('Invalid GIF signature');
  const width = word(), height = word(), packed = byte(), backgroundIndex = byte(); byte();
  if (!width || !height || width * height > limits.maxCanvasPixels) throw new Error('GIF canvas pixel budget exceeded');
  const palette = packed & 128 ? take(3 * (1 << ((packed & 7) + 1))) : null;
  const background = palette && backgroundIndex * 3 + 2 < palette.length ? [...palette.subarray(backgroundIndex * 3, backgroundIndex * 3 + 3), 255] : [0, 0, 0, 0];
  const frames: GifFrameHeader[] = [];
  let repeat: number | null = null, delayMs = 100, disposal = 0, transparent = false, transparentIndex = 0, pixels = 0, largest = 0, duration = 0;
  while (p < bytes.length) {
    if (++blockCount > limits.maxBlocks) throw new Error('GIF block count budget exceeded');
    const marker = byte();
    if (marker === 0x3b) {
      if (!frames.length || p !== bytes.length) throw new Error('GIF has no images or has trailing bytes');
      return { width, height, frames, repeat, background };
    }
    if (marker === 0x21) {
      const label = byte();
      if (label === 0xf9) {
        if (byte() !== 4) throw new Error('Invalid GIF graphic control block');
        const flags = byte(); disposal = flags >> 2 & 7; transparent = Boolean(flags & 1);
        // Policy: unspecified/zero delay is 100ms; positive centiseconds remain exact.
        delayMs = word() * 10 || 100; transparentIndex = byte();
        if (byte() !== 0 || disposal > 3 || flags & 2) throw new Error('Unsupported GIF disposal or user-input timing');
      } else if (label === 0xff) {
        const id = String.fromCharCode(...take(byte())); const parts = blocks();
        if (id === 'NETSCAPE2.0' || id === 'ANIMEXTS1.0') {
          if (parts.length !== 1 || parts[0].length !== 3 || parts[0][0] !== 1) throw new Error('Invalid GIF loop extension');
          repeat = parts[0][1] | parts[0][2] << 8;
        }
      } else if (label === 0xfe) blocks();
      else throw new Error('Unsupported GIF extension');
      continue;
    }
    if (marker !== 0x2c) throw new Error('Invalid GIF block marker');
    const left = word(), top = word(), w = word(), h = word(), flags = byte();
    if (!w || !h || left + w > width || top + h > height) throw new Error('GIF frame outside logical canvas');
    pixels += w * h; largest = Math.max(largest, w * h);
    // Estimate JS pixel arrays, RGBA patches, compressed parser copies and two compositor canvases.
    const workingBytes = pixels * 4 + largest * 12 + width * height * 8 + bytes.length * 4 + subBlockCount * 128 + blockCount * 256;
    if (frames.length >= limits.maxFrames || pixels > limits.maxPatchPixels || workingBytes > limits.maxWorkingBytes) throw new Error('GIF frame/decode memory budget exceeded');
    const localPalette = flags & 128 ? take(3 * (1 << ((flags & 7) + 1))) : palette;
    if (!localPalette) throw new Error('GIF frame has no color table');
    const minCodeSize = byte();
    if (minCodeSize < 2 || minCodeSize > 8) throw new Error('Invalid GIF LZW code size');
    validateGifLzw(blocks(), minCodeSize, w * h);
    if (pixels * 4 + largest * 12 + width * height * 8 + bytes.length * 4 + subBlockCount * 128 + blockCount * 256 > limits.maxWorkingBytes) throw new Error('GIF frame/decode memory budget exceeded');
    duration += delayMs;
    if (duration > limits.maxDurationMs) throw new Error('GIF duration budget exceeded');
    frames.push({ left, top, width: w, height: h, delayMs, disposal, transparent, transparentIndex });
    delayMs = 100; disposal = 0; transparent = false; transparentIndex = 0;
  }
  throw new Error('GIF trailer missing');
}

/** Validate dictionary lengths and termination; gifuct otherwise pads truncated images with zero pixels. */
function validateGifLzw(parts: Uint8Array[], min: number, expected: number): void {
  let part = 0, offset = 0, bits = 0, accumulator = 0;
  const read = (width: number): number => {
    while (bits < width) {
      while (part < parts.length && offset === parts[part].length) { part++; offset = 0; }
      if (part >= parts.length) throw new Error('Truncated GIF LZW stream');
      accumulator |= parts[part][offset++] << bits; bits += 8;
    }
    const value = accumulator & ((1 << width) - 1); accumulator >>>= width; bits -= width; return value;
  };
  const clear = 1 << min, end = clear + 1, lengths = new Uint16Array(4096);
  for (let i = 0; i < clear; i++) lengths[i] = 1;
  let width = min + 1, next = clear + 2, previous = 0, output = 0;
  if (read(width) !== clear) throw new Error('GIF LZW must begin with clear code');
  while (true) {
    const code = read(width);
    if (code === clear) { width = min + 1; next = clear + 2; previous = 0; continue; }
    if (code === end) { if (output !== expected) throw new Error('GIF LZW pixel count mismatch'); return; }
    if (code > next || code === next && !previous) throw new Error('Invalid GIF LZW dictionary code');
    const length = code === next ? previous + 1 : lengths[code];
    if (!length || output + length > expected) throw new Error('GIF LZW pixel count exceeds frame');
    output += length;
    if (previous && next < 4096) { lengths[next++] = previous + 1; if (next === 1 << width && width < 12) width++; }
    previous = length;
  }
}
