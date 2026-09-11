import { decodeGif, type GifAnimation } from '../shared/gif-timeline';
import { GIF_LIMITS } from '../shared/gif-bounds';
export async function loadGifAsset(url: string, signal?: AbortSignal): Promise<GifAnimation> {
  const response = await fetch(url, { signal }); if (!response.ok) throw new Error('GIF source is unavailable');
  if (Number(response.headers.get('content-length')) > GIF_LIMITS.maxSourceBytes) throw new Error('GIF source byte budget exceeded');
  const reader = response.body?.getReader(); if (!reader) throw new Error('GIF response has no body');
  const parts: Uint8Array[] = []; let length = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > GIF_LIMITS.maxSourceBytes) throw new Error('GIF source byte budget exceeded'); parts.push(part.value); } }
  finally { await reader.cancel(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return decodeGif(bytes);
}
