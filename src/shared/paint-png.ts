/** Bounded, lossless RGBA8 PNG interchange for paint tiles; arbitrary image formats use import. */
const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc(bytes: Uint8Array) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function concat(parts: Uint8Array[]) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0; for (const p of parts) { out.set(p, offset); offset += p.length; } return out; }
async function transform(bytes: Uint8Array, decompress: boolean, limit: number) {
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(decompress ? new DecompressionStream('deflate') : new CompressionStream('deflate'));
  const reader = stream.getReader(), parts: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) throw new Error('PNG decoded byte budget exceeded'); parts.push(part.value); } }
  finally { await reader.cancel(); }
  return concat(parts);
}
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(data.length + 12), view = new DataView(out.buffer);
  view.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8); view.setUint32(out.length - 4, crc(out.subarray(4, -4))); return out;
}
export async function encodePaintPng(width: number, height: number, pixels: Uint8Array): Promise<Uint8Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || pixels.length !== width * height * 4) throw new Error('Invalid PNG dimensions or pixels');
  const rows = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rows.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6;
  return concat([signature, chunk('IHDR', header), chunk('IDAT', await transform(rows, false, rows.length + 65536)), chunk('IEND', new Uint8Array())]);
}
export async function decodePaintTile(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length > 2 * 1024 * 1024 || !signature.every((b, i) => bytes[i] === b)) throw new Error('Invalid paint PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), data: Uint8Array[] = [];
  let offset = 8, header = false, ended = false, chunks = 0;
  while (offset + 12 <= bytes.length) {
    if (++chunks > 1024) throw new Error('PNG has too many chunks');
    const length = view.getUint32(offset), end = offset + length + 12;
    if (end > bytes.length) throw new Error('Truncated PNG');
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)), body = bytes.subarray(offset + 8, end - 4);
    if (crc(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) throw new Error('PNG checksum mismatch');
    if (type === 'IHDR') {
      if (header || offset !== 8 || length !== 13 || view.getUint32(offset + 8) !== 512 || view.getUint32(offset + 12) !== 512 || body[8] !== 8 || body[9] !== 6 || body[10] || body[11] || body[12]) throw new Error('Paint tiles require non-interlaced 512×512 RGBA8 PNG');
      header = true;
    } else if (type === 'IDAT' && header) data.push(body);
    else if (type === 'IEND') { if (length || !header || !data.length || end !== bytes.length) throw new Error('Invalid PNG end'); ended = true; break; }
    else if (type === 'acTL' || type === 'fcTL' || type === 'fdAT' || type[0] === type[0].toUpperCase() && type !== 'PLTE') throw new Error('Unsupported paint PNG chunk');
    offset = end;
  }
  if (!ended) throw new Error('Incomplete PNG');
  const stride = 512 * 4, raw = await transform(concat(data), true, (stride + 1) * 512);
  if (raw.length !== (stride + 1) * 512) throw new Error('Invalid PNG pixel count');
  const pixels = new Uint8Array(stride * 512);
  const paeth = (a: number, b: number, c: number) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < 512; y++) {
    const filter = raw[y * (stride + 1)]; if (filter > 4) throw new Error('Invalid PNG filter');
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, a = x >= 4 ? pixels[at - 4] : 0, b = y ? pixels[at - stride] : 0, c = y && x >= 4 ? pixels[at - stride - 4] : 0;
      pixels[at] = raw[y * (stride + 1) + x + 1] + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c));
    }
  }
  return pixels;
}
export async function paintHash(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}
