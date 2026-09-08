import JSZip from 'jszip';
import type { DesignDocument } from './schema';

export interface ReactRuntimeManifest { files: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> }
/** The manifest is compiled from trusted repository files, never from document text. */
export async function createReactArchive(input: DesignDocument, runtime: ReactRuntimeManifest) {
  if (!['web', 'wireframe'].includes(input.kind)) throw new Error('React source export supports Web and App interface projects.');
  const doc = structuredClone(input), zip = new JSZip(), saved = new Map<string, string>();
  const embed = (url: string) => {
    if (!url.startsWith('data:')) {
      if (url.startsWith('/api/') || url.startsWith('/published/')) throw new Error('Import and embed all private assets before React export.');
      return url;
    }
    if (saved.has(url)) return saved.get(url)!;
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
    if (!match) throw new Error('React export requires base64 media assets.');
    const ext: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'model/gltf-binary': 'glb' };
    const path = `assets/media-${saved.size + 1}.${ext[match[1]] ?? 'bin'}`;
    zip.file(`public/${path}`, match[2], { base64: true }); saved.set(url, `/${path}`); return `/${path}`;
  };
  for (const asset of doc.assets) asset.url = embed(asset.url);
  for (const page of doc.pages) for (const node of page.nodes) if (node.src) node.src = embed(node.src);
  for (const [path, source] of Object.entries(runtime.files)) {
    if (!/^src\/[a-zA-Z0-9_./-]+\.(tsx?|css)$/.test(path) || path.split('/').includes('..')) throw new Error('Invalid runtime source path.');
    zip.file(path, source);
  }
  zip.file('package.json', JSON.stringify({ name: 'studio-react-prototype', version: '1.0.0', private: true, type: 'module', scripts: { dev: 'vite --host 127.0.0.1', build: 'vite build', preview: 'vite preview --host 127.0.0.1' }, dependencies: runtime.dependencies, devDependencies: runtime.devDependencies }, null, 2));
  zip.file('document.json', JSON.stringify(doc, null, 2));
  zip.file('index.html', '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Design prototype</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
  zip.file('vite.config.ts', "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n");
  zip.file('README.md', '# React design prototype\n\nRequires Node.js 24+. Run `npm install`, then `npm run dev`. Use `npm run build` for a production build.\n\nEdit `document.json` or the included React component runtime. Assets are in `public/assets`. Ant Design and Radix-based components remain interactive; navigation, URL links, and visibility interactions use the validated document configuration. This is a frontend prototype: connect your own backend for persistence, authentication, and business actions. External HTTPS media remains externally hosted.\n');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
