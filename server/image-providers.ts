import { fail, unb64 } from './security';
import { providerCatalog } from '../src/shared/providers';

export const imageDefaults = { openai: 'gpt-image-1', gemini: 'gemini-3.1-flash-image', grok: providerCatalog.grok.model, leonardo: providerCatalog.leonardo.model };
export function buildImageRequest(provider: 'gemini' | 'grok' | 'leonardo', prompt: string, override?: string) {
  const model = override ?? imageDefaults[provider];
  if (provider === 'gemini') {
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) fail(400, 'invalid_model', 'Invalid Gemini model ID.');
    return { model, path: `/models/${model}:generateContent`, payload: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } } };
  }
  if (provider === 'grok') return { model, path: '/images/generations', payload: { model, prompt, n: 1, response_format: 'b64_json' } };
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(model)) fail(400, 'invalid_model', 'Leonardo image generation requires a model UUID.');
  return { model, path: '/generations', payload: { modelId: model, prompt, width: 1024, height: 1024, num_images: 1, public: false } };
}

export function decodeImageResult(result: any, protocol: string) {
  const parts = result?.candidates?.[0]?.content?.parts;
  const inline = Array.isArray(parts) ? parts.find((part: any) => !part.thought && part.inlineData?.data)?.inlineData : undefined;
  const encoded = protocol === 'gemini' ? inline?.data : result?.data?.[0]?.b64_json;
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > 28 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail(502, 'invalid_provider_response', 'Image provider returned no bounded base64 image. Check image model access or content restrictions.');
  let bytes: Uint8Array;
  try { bytes = unb64(encoded); } catch { fail(502, 'invalid_provider_response', 'Image provider returned invalid base64.'); }
  if (bytes.byteLength > 20 * 1024 * 1024) fail(502, 'provider_response_too_large', 'Generated image exceeds 20 MB.');
  // Detect the actual image type: xAI returns JPEG while GPT Image defaults to PNG.
  const mimeType = imageMime(bytes);
  if (protocol === 'gemini' && inline?.mimeType !== mimeType) fail(502, 'invalid_media_type', 'Image bytes do not match the provider media type.');
  return { bytes: bytes.buffer as ArrayBuffer, mimeType, extension: mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp' };
}
export function imageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return fail(502, 'invalid_media_type', 'Provider output must contain PNG, JPEG or WebP image bytes.');
}
export function leonardoJob(result: any): { status: 'processing' | 'completed'; url?: string } {
  const generation = result?.generations_by_pk;
  if (generation?.status === 'PENDING') return { status: 'processing' };
  if (generation?.status !== 'COMPLETE') fail(502, 'media_generation_failed', 'Leonardo generation failed or returned an unknown status.');
  const value = generation.generated_images?.[0]?.url;
  let url: URL;
  try { url = new URL(value); } catch { fail(502, 'invalid_media_url', 'Leonardo returned no image location.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname !== 'cdn.leonardo.ai' || url.port) fail(502, 'invalid_media_url', 'Leonardo returned an untrusted media location.');
  return { status: 'completed', url: url.href };
}
