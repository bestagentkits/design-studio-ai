import { z } from 'zod';
import { documentSchema, type DesignDocument, type AssetRef } from './schema';
import type { CommunityAttribution } from './community';
import { communityProjection, COMMUNITY_PROJECTION_POLICY_VERSION } from './community-projection';
import { visitDocumentAssetIds } from './document-asset-references';
import { inspectElementImage } from './creative-elements-image-bounds';
import { inspectGif } from './gif-bounds';

export const COMMUNITY_PACKAGE_LIMITS = Object.freeze({ zipBytes: 20 * 1024 ** 2, expandedBytes: 64 * 1024 ** 2, entries: 1000, assetBytes: 20 * 1024 ** 2, documentBytes: 16 * 1024 ** 2, manifestBytes: 1024 ** 2, jsonDepth: 64 });
export interface CommunityPackageAsset { id: string; name: string; mimeType: string; bytes: Uint8Array }
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const idSchema = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const mimeExtensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'model/gltf-binary': 'glb' };
const attributionSchema = z.object({ listingId: idSchema.optional(), version: z.number().int().positive().optional(), title: z.string().min(1).max(200), creator: z.object({ handle: z.string().max(40), displayName: z.string().min(1).max(100) }).strict(), license: z.literal('CC-BY-4.0'), url: z.string().max(2000).url().refine(s => { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password; }).optional(), verified: z.boolean().optional() }).strict();
const fileSchema = z.object({ path: z.string().min(1).max(200), size: z.number().int().min(0).max(COMMUNITY_PACKAGE_LIMITS.assetBytes), sha256: hashSchema }).strict();
const manifestSchema = z.object({ format: z.literal('design-studio-community'), version: z.literal(1), projectionPolicyVersion: z.literal(COMMUNITY_PROJECTION_POLICY_VERSION), document: z.literal('document.json'), attribution: z.literal('ATTRIBUTION.json'), license: z.literal('LICENSE.txt'), files: z.array(fileSchema).max(COMMUNITY_PACKAGE_LIMITS.entries - 1), assets: z.array(z.object({ id: idSchema, path: z.string().max(200), name: z.string().max(300), mimeType: z.string().max(100), size: z.number().int().min(1).max(COMMUNITY_PACKAGE_LIMITS.assetBytes), sha256: hashSchema }).strict()).max(COMMUNITY_PACKAGE_LIMITS.entries - 5) }).strict();
type Manifest = z.infer<typeof manifestSchema>;

export async function communityPackageHash(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer instanceof ArrayBuffer ? bytes as Uint8Array<ArrayBuffer> : new Uint8Array(bytes);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', input))].map(v => v.toString(16).padStart(2, '0')).join('');
}
function jsonValue(bytes: Uint8Array, max: number): unknown {
  if (bytes.length > max) throw new Error('Package JSON exceeds its byte limit.');
  const text = decoder.decode(bytes); let depth = 0, quoted = false, escaped = false;
  for (const char of text) {
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') { if (++depth > COMMUNITY_PACKAGE_LIMITS.jsonDepth) throw new Error('Package JSON nesting exceeds its limit.'); }
    else if (char === '}' || char === ']') depth--;
  }
  return JSON.parse(text);
}
function validateMedia(bytes: Uint8Array, mime: string) {
  if (!mimeExtensions[mime] || !bytes.length || bytes.length > COMMUNITY_PACKAGE_LIMITS.assetBytes) throw new Error('Package media must be a supported image, audio, video or GLB under 20 MiB.');
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const valid: Record<string, boolean> = {
    'image/png': [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v),
    'image/jpeg': bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    'image/webp': ascii(0,4) === 'RIFF' && ascii(8,4) === 'WEBP',
    'image/gif': ['GIF87a','GIF89a'].includes(ascii(0,6)),
    'audio/mpeg': ascii(0,3) === 'ID3' || bytes[0] === 255 && (bytes[1] & 224) === 224,
    'audio/wav': ascii(0,4) === 'RIFF' && ascii(8,4) === 'WAVE',
    'audio/ogg': ascii(0,4) === 'OggS', 'video/mp4': ascii(4,4) === 'ftyp',
    'video/webm': [26,69,223,163].every((v,i) => bytes[i] === v), 'model/gltf-binary': ascii(0,4) === 'glTF',
  };
  if (!valid[mime]) throw new Error('Package media bytes do not match their declared MIME type.');
  if (['image/png','image/jpeg','image/webp'].includes(mime)) inspectElementImage(bytes, mime);
  if (mime === 'image/gif') inspectGif(bytes);
  if (mime === 'model/gltf-binary') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 20 || view.getUint32(4,true) !== 2 || view.getUint32(8,true) !== bytes.length) throw new Error('Invalid GLB header.');
    let cursor = 12, jsonCount = 0;
    while (cursor < bytes.length) {
      if (cursor + 8 > bytes.length) throw new Error('Truncated GLB chunk.');
      const length = view.getUint32(cursor,true), kind = view.getUint32(cursor + 4,true);
      if (length % 4 || cursor + 8 + length > bytes.length) throw new Error('Invalid GLB chunk size.');
      if (kind === 0x4e4f534a) {
        if (cursor !== 12 || ++jsonCount !== 1) throw new Error('Invalid GLB JSON chunk.');
        const value = jsonValue(bytes.subarray(cursor + 8, cursor + 8 + length), COMMUNITY_PACKAGE_LIMITS.documentBytes);
        const check = (item: unknown): void => {
          if (!item || typeof item !== 'object') return;
          for (const [key, child] of Object.entries(item)) {
            if (key === 'uri') throw new Error('GLB contains external or inline media dependencies. Embed all buffers and images in its binary chunk before publishing.');
            check(child);
          }
        };
        check(value);
      } else if (kind !== 0x004e4942) throw new Error('Unsupported GLB chunk.');
      cursor += 8 + length;
    }
    if (jsonCount !== 1) throw new Error('GLB has no JSON chunk.');
  }
}
function inlineMedia(url: string) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
  if (!match) throw new Error('Import media into Studio before packaging; only owned or embedded media can be shared.');
  const encoded = match[2].replace(/\s/g, '');
  if (encoded.length > Math.ceil(COMMUNITY_PACKAGE_LIMITS.assetBytes / 3) * 4 || encoded.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('Invalid or oversized inline media.');
  const raw = atob(encoded), bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  validateMedia(bytes, match[1]);
  return { bytes, mimeType: match[1] };
}

/** Explicit media locations only; hyperlink actions remain ordinary links. */
function mediaReferences(document: DesignDocument) {
  const ids = new Set<string>(), urls = new Set<string>();
  visitDocumentAssetIds(document, id => { ids.add(id); return id; });
  for (const page of document.pages) for (const node of page.nodes) {
    if (node.src) urls.add(node.src);
    // Component media are rendered from the canonical node src. Reject a second opaque URL.
    for (const [key, value] of Object.entries(node.component?.props ?? {})) if (/^(src|poster|image|avatar|url)$/i.test(key) && typeof value === 'string' && /^(?:https?:|data:|\/)/i.test(value)) throw new Error('Move component media into its canonical image src before packaging.');
    for (const value of Object.values(node.style ?? {})) if (typeof value === 'string' && /url\s*\(/i.test(value)) throw new Error('Import CSS media into a canonical image node before packaging.');
  }
  return { ids, urls };
}

const licenseText = 'Creative Commons Attribution 4.0 International (CC BY 4.0)\n\nThis design is licensed under CC BY 4.0. You may share and adapt it for any purpose, provided you give appropriate credit, link to the license, and indicate changes. No additional restrictions may be applied.\n\nFull license: https://creativecommons.org/licenses/by/4.0/legalcode\nAttribution: see ATTRIBUTION.json.\n';
const readmeText = '# Studio project package\n\nImport this ZIP with Studio Community import. document.json uses canonical Studio schema with package-local /api/assets/<id> references resolved only through manifest.json. It is not a standalone file that fetches assets from a server.\n\nVisible structure is editable; paintings contain visible composites rather than original layers. See ATTRIBUTION.json and LICENSE.txt for credit and terms. Attribution in an imported package is declared, not server-verified lineage.\n';

/** Build a portable, self-contained ZIP from the same projection used for public preview. */
export async function buildCommunityPackage(input: DesignDocument, sources: CommunityPackageAsset[], credit: CommunityAttribution, seed:string=crypto.randomUUID()): Promise<Uint8Array> {
  const document = communityProjection(input).document;
  const attribution = attributionSchema.parse({ ...credit, verified: false });
  const sourceMap = new Map(sources.map(a => [a.id, a]));
  if (sourceMap.size !== sources.length) throw new Error('Duplicate package source asset IDs.');
  const { ids, urls } = mediaReferences(document);
  const declared = new Map(document.assets.map(a => [a.id, a]));
  for (const id of ids) if (!declared.has(id)) throw new Error('The public design has a missing media asset. Import it before publishing.');
  const candidates: AssetRef[] = [...document.assets];
  for (const url of urls) if (!candidates.some(a => a.url === url)) candidates.push({ id: `inline-source-${candidates.length}`, name: 'Media', type: 'media', mimeType: '', url });
  const files = new Map<string, Uint8Array>(), assets: Manifest['assets'] = [], mapping = new Map<string, AssetRef>(), urlMapping = new Map<string, string>();
  let expanded = 0;
  for (const asset of candidates) {
    const existingUrl = urlMapping.get(asset.url);
    if (existingUrl) {
      const existing = [...mapping.values()].find(a => a.url === existingUrl)!;
      if (asset.mimeType && asset.mimeType !== existing.mimeType) throw new Error('Aliases of the same media URL must have the same MIME type.');
      mapping.set(asset.id, existing);
      continue;
    }
    let bytes: Uint8Array, mimeType: string;
    if (asset.url.startsWith('data:')) ({ bytes, mimeType } = inlineMedia(asset.url));
    else {
      if (!/^\/api\/assets\/[\w-]+$/.test(asset.url)) throw new Error('Import remote, published or Community media into this project before packaging.');
      const source = sourceMap.get(asset.id) ?? sourceMap.get(asset.url.slice('/api/assets/'.length));
      if (!source) throw new Error('An owned media file is missing from the package input. Upload it again before publishing.');
      bytes = source.bytes; mimeType = source.mimeType;
      if (asset.mimeType && asset.mimeType !== mimeType) throw new Error('Package asset MIME type does not match the document.');
      validateMedia(bytes, mimeType);
    }
    expanded += bytes.length;
    if (expanded > COMMUNITY_PACKAGE_LIMITS.expandedBytes || assets.length >= COMMUNITY_PACKAGE_LIMITS.entries - 5) throw new Error('Package media exceeds archive limits. Reduce the number or size of media assets.');
    const id = `package-${await communityPackageHash(encoder.encode(JSON.stringify([seed,asset.id])))}`, path = `assets/${id}.${mimeExtensions[mimeType]}`, name = `Media ${assets.length + 1}`;
    files.set(path, bytes);
    const sha256 = await communityPackageHash(bytes);
    assets.push({ id, path, name, mimeType, size: bytes.length, sha256 });
    const replacement: AssetRef = { id, name, type: mimeType.split('/')[0], mimeType, url: `/api/assets/${id}`, size: bytes.length };
    mapping.set(asset.id, replacement); urlMapping.set(asset.url, replacement.url);
  }
  visitDocumentAssetIds(document, id => mapping.get(id)?.id ?? id);
  document.assets = [...new Map([...mapping.values()].map(asset => [asset.id,asset])).values()];
  for (const page of document.pages) for (const node of page.nodes) if (node.src) node.src = urlMapping.get(node.src)!;
  documentSchema.parse(document);
  const documentBytes = encoder.encode(JSON.stringify(document));
  jsonValue(documentBytes, COMMUNITY_PACKAGE_LIMITS.documentBytes);
  files.set('document.json', documentBytes);
  files.set('ATTRIBUTION.json', encoder.encode(JSON.stringify(attribution)));
  files.set('LICENSE.txt', encoder.encode(licenseText)); files.set('README.md', encoder.encode(readmeText));
  const records: Manifest['files'] = [];
  for (const [path, bytes] of files) records.push({ path, size: bytes.length, sha256: await communityPackageHash(bytes) });
  const manifest = manifestSchema.parse({ format: 'design-studio-community', version: 1, projectionPolicyVersion: COMMUNITY_PROJECTION_POLICY_VERSION, document: 'document.json', attribution: 'ATTRIBUTION.json', license: 'LICENSE.txt', files: records, assets });
  files.set('manifest.json', encoder.encode(JSON.stringify(manifest)));
  if (files.get('manifest.json')!.length > COMMUNITY_PACKAGE_LIMITS.manifestBytes) throw new Error('Package manifest exceeds its byte limit.');
  return storedZip(files);
}

const crcTable = Uint32Array.from({length: 256}, (_, value) => { let c = value; for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
function crc32(bytes: Uint8Array) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0; }

// STORE needs no compressor dependency and has a predictable memory/size bound.
function storedZip(files: Map<string, Uint8Array>): Uint8Array {
  const entries = [...files].map(([name, bytes]) => ({ name: encoder.encode(name), bytes, crc: crc32(bytes) }));
  const expanded = entries.reduce((n,e) => n + e.bytes.length, 0);
  const length = expanded + entries.reduce((n,e) => n + 76 + 2 * e.name.length, 22);
  if (expanded > COMMUNITY_PACKAGE_LIMITS.expandedBytes || length > COMMUNITY_PACKAGE_LIMITS.zipBytes || entries.length > COMMUNITY_PACKAGE_LIMITS.entries) throw new Error('Studio project package exceeds the 20 MiB ZIP or 64 MiB expanded limit. Reduce media size.');
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer), offsets: number[] = []; let cursor = 0;
  for (const entry of entries) {
    offsets.push(cursor); view.setUint32(cursor,0x04034b50,true); view.setUint16(cursor+4,20,true); view.setUint16(cursor+6,0x800,true);
    view.setUint32(cursor+14,entry.crc,true); view.setUint32(cursor+18,entry.bytes.length,true); view.setUint32(cursor+22,entry.bytes.length,true); view.setUint16(cursor+26,entry.name.length,true);
    bytes.set(entry.name,cursor+30); bytes.set(entry.bytes,cursor+30+entry.name.length); cursor += 30+entry.name.length+entry.bytes.length;
  }
  const directory = cursor;
  entries.forEach((entry,index) => {
    view.setUint32(cursor,0x02014b50,true); view.setUint16(cursor+4,20,true); view.setUint16(cursor+6,20,true); view.setUint16(cursor+8,0x800,true);
    view.setUint32(cursor+16,entry.crc,true); view.setUint32(cursor+20,entry.bytes.length,true); view.setUint32(cursor+24,entry.bytes.length,true); view.setUint16(cursor+28,entry.name.length,true); view.setUint32(cursor+42,offsets[index],true);
    bytes.set(entry.name,cursor+46); cursor += 46+entry.name.length;
  });
  view.setUint32(cursor,0x06054b50,true); view.setUint16(cursor+8,entries.length,true); view.setUint16(cursor+10,entries.length,true); view.setUint32(cursor+12,cursor-directory,true); view.setUint32(cursor+16,directory,true);
  return bytes;
}

interface ZipEntry { name: string; start: number; compressed: number; expanded: number; method: number; crc: number; offset: number; end: number }
function zipDirectory(bytes: Uint8Array): ZipEntry[] {
  if (bytes.length < 22 || bytes.length > COMMUNITY_PACKAGE_LIMITS.zipBytes) throw new Error('Studio package must be a ZIP no larger than 20 MiB.');
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); let eocd = -1;
  for (let p = bytes.length - 22; p >= Math.max(0,bytes.length - 65557); p--) if (view.getUint32(p,true) === 0x06054b50 && p + 22 + view.getUint16(p+20,true) === bytes.length) { eocd = p; break; }
  if (eocd < 0) throw new Error('Missing ZIP end directory.');
  const count = view.getUint16(eocd+10,true), directory = view.getUint32(eocd+16,true), size = view.getUint32(eocd+12,true);
  if (view.getUint16(eocd+4,true) || view.getUint16(eocd+6,true) || view.getUint16(eocd+8,true) !== count || count < 4 || count > COMMUNITY_PACKAGE_LIMITS.entries || count === 0xffff || directory === 0xffffffff || directory+size !== eocd) throw new Error('Unsupported ZIP64, multi-volume or oversized ZIP directory.');
  const entries: ZipEntry[] = [], names = new Set<string>(); let cursor = directory, total = 0;
  const extras = (start: number, length: number) => {
    for (let p = start; p < start+length;) {
      if (p+4 > start+length) throw new Error('Truncated ZIP extra field.');
      const tag = view.getUint16(p,true), size = view.getUint16(p+2,true);
      if (tag === 1 || tag === 0x9901 || p+4+size > start+length) throw new Error('Unsupported ZIP64/encrypted or malformed ZIP extra field.');
      p += 4+size;
    }
  };
  for (let n = 0; n < count; n++) {
    if (cursor+46 > eocd || view.getUint32(cursor,true) !== 0x02014b50) throw new Error('Invalid ZIP central entry.');
    const flags = view.getUint16(cursor+8,true), method = view.getUint16(cursor+10,true), crc = view.getUint32(cursor+16,true), compressed = view.getUint32(cursor+20,true), expanded = view.getUint32(cursor+24,true), nameLength = view.getUint16(cursor+28,true), extra = view.getUint16(cursor+30,true), comment = view.getUint16(cursor+32,true), offset = view.getUint32(cursor+42,true), mode = view.getUint32(cursor+38,true) >>> 16;
    if (cursor+46+nameLength+extra+comment > eocd || view.getUint16(cursor+6,true) > 20 || flags & ~0x808 || ![0,8].includes(method) || view.getUint16(cursor+34,true) || compressed === 0xffffffff || expanded === 0xffffffff || offset === 0xffffffff || (mode & 0xf000) && (mode & 0xf000) !== 0x8000) throw new Error('Unsupported encryption, compression, symlink or invalid ZIP entry.');
    const name = decoder.decode(bytes.subarray(cursor+46,cursor+46+nameLength));
    if (!/^(?:manifest\.json|document\.json|ATTRIBUTION\.json|LICENSE\.txt|README\.md|assets\/[a-zA-Z0-9_-]+\.(?:png|jpg|webp|gif|mp3|wav|ogg|mp4|webm|glb))$/.test(name) || names.has(name.toLowerCase())) throw new Error('Unsafe, duplicate or unexpected archive path.');
    names.add(name.toLowerCase()); extras(cursor+46+nameLength,extra);
    total += expanded;
    if (total > COMMUNITY_PACKAGE_LIMITS.expandedBytes || expanded > COMMUNITY_PACKAGE_LIMITS.assetBytes || (method === 0 && compressed !== expanded)) throw new Error('Expanded ZIP entry exceeds archive limits.');
    if (offset+30 > directory || view.getUint32(offset,true) !== 0x04034b50) throw new Error('Invalid ZIP local entry.');
    const localName = view.getUint16(offset+26,true), localExtra = view.getUint16(offset+28,true), start = offset+30+localName+localExtra;
    if (start+compressed > directory || view.getUint16(offset+4,true) !== view.getUint16(cursor+6,true) || view.getUint16(offset+6,true) !== flags || view.getUint16(offset+8,true) !== method || localName !== nameLength || decoder.decode(bytes.subarray(offset+30,offset+30+localName)) !== name) throw new Error('ZIP central/local header mismatch.');
    extras(offset+30+localName,localExtra);
    let end = start+compressed;
    if (flags & 8) {
      if (end+12 > directory) throw new Error('Truncated ZIP data descriptor.');
      if (view.getUint32(end,true) === 0x08074b50) end += 4;
      if (end+12 > directory || view.getUint32(end,true) !== crc || view.getUint32(end+4,true) !== compressed || view.getUint32(end+8,true) !== expanded) throw new Error('ZIP data descriptor mismatch.');
      end += 12;
      for (const [at,expected] of [[14,crc],[18,compressed],[22,expanded]]) if (view.getUint32(offset+at,true) !== 0 && view.getUint32(offset+at,true) !== expected) throw new Error('ZIP local descriptor fields mismatch.');
    } else if (view.getUint32(offset+14,true) !== crc || view.getUint32(offset+18,true) !== compressed || view.getUint32(offset+22,true) !== expanded) throw new Error('ZIP central/local size or CRC mismatch.');
    entries.push({name,start,compressed,expanded,method,crc,offset,end}); cursor += 46+nameLength+extra+comment;
  }
  if (cursor !== eocd) throw new Error('ZIP directory size mismatch.');
  let end = 0;
  for (const entry of [...entries].sort((a,b) => a.offset-b.offset)) { if (entry.offset !== end) throw new Error('Overlapping, prefixed or unlisted ZIP data.'); end = entry.end; }
  if (end !== directory) throw new Error('Unlisted ZIP data before central directory.');
  return entries;
}
async function inflateEntry(bytes: Uint8Array, entry: ZipEntry, running: {bytes: number}): Promise<Uint8Array> {
  let output: Uint8Array;
  if (entry.method === 0) { output = bytes.slice(entry.start,entry.start+entry.compressed); running.bytes += output.length; }
  else {
    if (typeof DecompressionStream === 'undefined') throw new Error('This runtime cannot inflate ZIP packages. Import using a supported browser or server.');
    let position = entry.start;
    const end = entry.start + entry.compressed;
    // Native inflation can expand a whole input chunk before JS observes output.
    // Small pull-driven chunks let the byte guard cancel a bomb before that allocation grows.
    const compressed = new ReadableStream<BufferSource>({
      pull(controller) {
        if (position === end) { controller.close(); return; }
        const next = Math.min(position + 1024, end);
        controller.enqueue(new Uint8Array(bytes.subarray(position, next)));
        position = next;
      },
    });
    const reader = compressed.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    output = new Uint8Array(entry.expanded);
    let length = 0;
    try {
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        const nextLength = length + value.length;
        running.bytes += value.length;
        if (nextLength > entry.expanded || nextLength > COMMUNITY_PACKAGE_LIMITS.assetBytes || running.bytes > COMMUNITY_PACKAGE_LIMITS.expandedBytes) throw new Error('Actual inflated ZIP bytes exceed declared size or archive limits.');
        output.set(value, length);
        length = nextLength;
      }
    } finally { await reader.cancel().catch(() => {}); }
    if (length !== entry.expanded) throw new Error('ZIP size or CRC integrity check failed.');
  }
  if (running.bytes > COMMUNITY_PACKAGE_LIMITS.expandedBytes || output.length !== entry.expanded || crc32(output) !== entry.crc) throw new Error('ZIP size or CRC integrity check failed.');
  return output;
}

/** Never extracts paths or fetches URLs. Package IDs resolve exclusively to checked archive bytes. */
export async function readCommunityPackage(bytes: Uint8Array): Promise<{document: DesignDocument; assets: CommunityPackageAsset[]; attribution: CommunityAttribution}> {
  const entries = zipDirectory(bytes), running = {bytes: 0};
  const manifestEntry = entries.find(e => e.name === 'manifest.json');
  if (!manifestEntry || manifestEntry.expanded > COMMUNITY_PACKAGE_LIMITS.manifestBytes) throw new Error('Package manifest is missing or oversized.');
  const manifest = manifestSchema.parse(jsonValue(await inflateEntry(bytes,manifestEntry,running),COMMUNITY_PACKAGE_LIMITS.manifestBytes));
  const records = new Map(manifest.files.map(f => [f.path,f]));
  if (records.size !== manifest.files.length || entries.length !== records.size+1 || records.has('manifest.json')) throw new Error('Manifest must describe each archive payload exactly once.');
  const required = ['document.json','ATTRIBUTION.json','LICENSE.txt','README.md'];
  for (const name of required) if (!records.has(name)) throw new Error('Package is missing document, attribution, license or import instructions.');
  const assetsByPath = new Map(manifest.assets.map(a => [a.path,a]));
  if (assetsByPath.size !== manifest.assets.length || new Set(manifest.assets.map(a => a.id)).size !== manifest.assets.length || records.size !== manifest.assets.length+4) throw new Error('Duplicate or incomplete manifest asset mapping.');
  for (const asset of manifest.assets) {
    const record = records.get(asset.path);
    if (!mimeExtensions[asset.mimeType] || asset.path !== `assets/${asset.id}.${mimeExtensions[asset.mimeType]}` || !record || record.size !== asset.size || record.sha256 !== asset.sha256) throw new Error('Manifest asset mapping is inconsistent.');
  }
  let document: DesignDocument | undefined, attribution: CommunityAttribution | undefined;
  const assets: CommunityPackageAsset[] = [];
  for (const entry of entries) {
    if (entry.name === 'manifest.json') continue;
    const record = records.get(entry.name);
    if (!record || record.size !== entry.expanded) throw new Error('Archive payload is not declared correctly by its manifest.');
    if (entry.name === 'document.json' && entry.expanded > COMMUNITY_PACKAGE_LIMITS.documentBytes || required.includes(entry.name) && entry.name !== 'document.json' && entry.expanded > 65536) throw new Error('Package document or metadata exceeds its byte limit.');
    const payload = await inflateEntry(bytes,entry,running);
    if (await communityPackageHash(payload) !== record.sha256) throw new Error('Package SHA-256 integrity check failed.');
    const asset = assetsByPath.get(entry.name);
    if (asset) { validateMedia(payload,asset.mimeType); assets.push({id:asset.id,name:asset.name,mimeType:asset.mimeType,bytes:payload}); }
    else if (entry.name === 'document.json') document = documentSchema.parse(jsonValue(payload,COMMUNITY_PACKAGE_LIMITS.documentBytes));
    else if (entry.name === 'ATTRIBUTION.json') attribution = { ...attributionSchema.parse(jsonValue(payload,65536)), verified: false };
    else if (entry.name === 'LICENSE.txt' && decoder.decode(payload) !== licenseText) throw new Error('Package license does not match the supported CC BY 4.0 terms.');
  }
  if (!document || !attribution) throw new Error('Package has no canonical document or attribution.');
  const {ids,urls} = mediaReferences(document), manifestAssets = new Map(manifest.assets.map(a => [a.id,a]));
  if (document.assets.length !== manifest.assets.length) throw new Error('Every package asset must have exactly one canonical registry entry.');
  for (const asset of document.assets) {
    const entry = manifestAssets.get(asset.id);
    if (!entry || asset.url !== `/api/assets/${asset.id}` || asset.mimeType !== entry.mimeType || asset.size !== entry.size || asset.name !== entry.name) throw new Error('Document media must resolve exclusively to matching manifest entries.');
  }
  for (const url of urls) {
    const match = /^\/api\/assets\/([\w-]+)$/.exec(url);
    if (!match || !manifestAssets.has(match[1])) throw new Error('Package contains remote, inline or unmapped media. Import never fetches URLs.');
    ids.add(match[1]);
  }
  if ([...ids].some(id => !manifestAssets.has(id)) || manifest.assets.some(a => !ids.has(a.id))) throw new Error('Package contains unresolved or unreferenced media assets.');
  // Reapply the public field policy to untrusted archives as well as native exports.
  const projected = communityProjection(document).document;
  if (projected.assets.length !== assets.length) throw new Error('Package contains private or unused payload assets. Rebuild it from the public design before importing.');
  return { document: projected, assets, attribution };
}
