import { build } from 'esbuild';
await build({ entryPoints: ['scripts/export-renderer.ts'], outfile: 'public/studio-renderer.js', bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2022' });
await build({ entryPoints: ['scripts/published-viewer.ts'], outfile: 'public/studio-viewer.js', bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2022' });

await build({ entryPoints: ['scripts/geometry-worker.ts'], outfile: 'public/studio-geometry-worker.js', bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2022' });

// Ship editable trusted source alongside the viewer; the export archive uses no generated user code.
const { readFile, writeFile } = await import('node:fs/promises');
const sourceFiles = ['src/shared/motion-duration.ts','src/app/character-scene-layer.tsx','src/shared/scene-runtime.ts','src/shared/motion-events.ts','src/app/character-view.tsx','src/shared/character-schema.ts','src/shared/character-validation.ts','src/shared/character-math.ts','src/shared/character-runtime.ts','src/shared/character-constraints.ts','src/shared/motion-channels.ts','src/shared/character-svg.ts','src/shared/character-canvas.ts','src/shared/character-webgl.ts','src/app/document-view.tsx', 'src/app/design-component.tsx', 'src/shared/schema.ts', 'src/shared/design-capabilities.ts', 'src/shared/layout.ts', 'src/shared/render.ts', 'src/shared/easing.ts', 'src/shared/font-loading.ts'];
const files = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, await readFile(path, 'utf8')])));
// Exported local media is portable and limited to the archive's own asset folder.
files['src/shared/schema.ts'] = files['src/shared/schema.ts'].replace('export function isSafeUrl(value: string): boolean {', "export function isSafeUrl(value: string): boolean {\n  if (/^\\/assets\\/media-[0-9]+\\.[a-z0-9]+$/.test(value)) return true;");
files['src/main.tsx'] = await readFile('scripts/react-prototype-entry.txt', 'utf8');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const dependencies = Object.fromEntries(Object.entries(pkg.dependencies).filter(([name]) => ['react', 'react-dom', 'antd', 'zod','three'].includes(name) || name.startsWith('@radix-ui/')));
const devDependencies = Object.fromEntries(Object.entries(pkg.devDependencies).filter(([name]) => ['vite', '@vitejs/plugin-react', 'typescript', '@types/react', '@types/react-dom'].includes(name)));
await writeFile('public/studio-react-runtime.json', JSON.stringify({ files, dependencies, devDependencies }));

await build({entryPoints:['scripts/character-worker.ts'],outfile:'public/studio-character-worker.js',bundle:true,minify:true,format:'iife',platform:'browser',target:'es2022'});

await build({entryPoints:['scripts/scene-worker.ts'],outfile:'public/studio-scene-worker.js',bundle:true,minify:true,format:'iife',platform:'browser',target:'es2022'});
