import { build } from 'esbuild';
await build({ entryPoints: ['scripts/export-renderer.ts'], outfile: 'public/studio-renderer.js', bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2022' });
await build({ entryPoints: ['scripts/published-viewer.ts'], outfile: 'public/studio-viewer.js', bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2022' });
