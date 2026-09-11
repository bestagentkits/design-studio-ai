import { build } from 'esbuild';
await build({ entryPoints: ['scripts/export-renderer.ts'], outfile: 'public/studio-renderer.js', bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2022' });
await build({ entryPoints: ['scripts/published-viewer.ts'], outfile: 'public/studio-viewer.js', bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2022' });

await build({ entryPoints: ['scripts/geometry-worker.ts'], outfile: 'public/studio-geometry-worker.js', bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2022' });

// Ship editable trusted source alongside the viewer; the export archive uses no generated user code.
const { readFile, writeFile, access } = await import('node:fs/promises');
const { posix } = await import('node:path');
const sourceFiles = ['src/app/document-view.tsx', 'src/app/creative-elements-board-view.tsx', 'src/app/creative-elements-gif.tsx', 'src/app/creative-elements-gif-loader.ts', 'src/shared/creative-elements-gif-playback.ts', 'src/shared/gif-timeline.ts', 'src/shared/gif-bounds.ts', 'src/app/design-component.tsx', 'src/shared/schema.ts', 'src/shared/design-capabilities.ts', 'src/shared/layout.ts', 'src/shared/render.ts', 'src/shared/easing.ts', 'src/shared/font-loading.ts', 'src/shared/board-schema.ts', 'src/shared/painting-schema.ts', 'src/shared/creative-validation.ts', 'src/shared/board-render.ts', 'src/shared/ink-stroke.ts', 'src/shared/board-geometry.ts', 'src/shared/board-geometry-path.ts', 'src/shared/board-geometry-stroke.ts', 'src/shared/motion-duration.ts', 'src/app/character-scene-layer.tsx', 'src/shared/scene-runtime.ts', 'src/shared/motion-events.ts', 'src/app/character-view.tsx', 'src/shared/character-schema.ts', 'src/shared/character-validation.ts', 'src/shared/character-math.ts', 'src/shared/character-runtime.ts', 'src/shared/character-constraints.ts', 'src/shared/motion-channels.ts', 'src/shared/character-svg.ts', 'src/shared/character-canvas.ts', 'src/shared/character-webgl.ts'];
// Include the relative source closure, including type-only imports needed by TypeScript.
const files = {}, queue = [...sourceFiles], externalPackages = new Set();
while (queue.length) {
  const path = queue.shift(); if (files[path] !== undefined) continue;
  const source = await readFile(path, 'utf8'); files[path] = source;
  for (const match of source.matchAll(/(?:import|export)\s+(?:[^'"]*?\s+from\s*)?['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) { externalPackages.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]); continue; }
    const base = posix.normalize(posix.join(posix.dirname(path), specifier));
    let resolved;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) { try { await access(candidate); resolved = candidate; break; } catch {} }
    if (!resolved) throw new Error(`Portable runtime cannot resolve ${specifier} from ${path}`);
    queue.push(resolved);
  }
}
// Exported local media is portable and limited to the archive's own asset folder.
files['src/shared/schema.ts'] = files['src/shared/schema.ts'].replace('export function isSafeUrl(value: string): boolean {', "export function isSafeUrl(value: string): boolean {\n  if (/^\\/assets\\/media-[0-9]+\\.[a-z0-9]+$/.test(value)) return true;");
files['src/main.tsx'] = await readFile('scripts/react-prototype-entry.txt', 'utf8');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const dependencies = Object.fromEntries(Object.entries(pkg.dependencies).filter(([name]) => ['react', 'react-dom', 'antd', 'zod','three', 'perfect-freehand', 'gifuct-js'].includes(name) || name.startsWith('@radix-ui/') || externalPackages.has(name)));
const devDependencies = Object.fromEntries(Object.entries(pkg.devDependencies).filter(([name]) => ['vite', '@vitejs/plugin-react', 'typescript', '@types/react', '@types/react-dom'].includes(name)));
await writeFile('public/studio-react-runtime.json', JSON.stringify({ files, dependencies, devDependencies }));

await build({entryPoints:['scripts/character-worker.ts'],outfile:'public/studio-character-worker.js',bundle:true,minify:true,format:'iife',platform:'browser',target:'es2022'});

await build({entryPoints:['scripts/scene-worker.ts'],outfile:'public/studio-scene-worker.js',bundle:true,minify:true,format:'iife',platform:'browser',target:'es2022'});
