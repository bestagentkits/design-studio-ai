// A real GIF89a encoder for the tiny test image: clear before each palette index
// keeps the LZW code width at three bits. The production decoder receives bytes.
export function gif(repeat: number | null = 1): Uint8Array {
  const out = [...Buffer.from('GIF89a'), 2, 0, 1, 0, 0x81, 0, 0,
    0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
  if (repeat !== null) out.push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, repeat & 255, repeat >> 8, 0);
  const frames = [
    { pixels: [1, 1], delay: 2, disposal: 1, transparent: false, left: 0 },
    { pixels: [2, 0], delay: 3, disposal: 3, transparent: true, left: 0 },
    { pixels: [3], delay: 4, disposal: 2, transparent: true, left: 1 },
    { pixels: [2], delay: 5, disposal: 1, transparent: true, left: 0 },
  ];
  for (const frame of frames) {
    out.push(0x21, 0xf9, 4, frame.disposal << 2 | Number(frame.transparent), frame.delay, 0, 0, 0);
    out.push(0x2c, frame.left, 0, 0, 0, frame.pixels.length, 0, 1, 0, 0, 2);
    const codes = frame.pixels.flatMap(index => [4, index]).concat(5);
    let bits = 0, value = 0; const data: number[] = [];
    for (const code of codes) { value |= code << bits; bits += 3; while (bits >= 8) { data.push(value & 255); value >>>= 8; bits -= 8; } }
    if (bits) data.push(value);
    out.push(data.length, ...data, 0);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}
