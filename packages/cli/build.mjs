import { build } from 'esbuild';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const directory = fileURLToPath(new URL('.', import.meta.url));
await mkdir(new URL('dist/', import.meta.url), { recursive: true });
await build({
  absWorkingDir: directory,
  entryPoints: ['src/dsa.ts'],
  outfile: 'dist/dsa.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node\nimport { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  sourcemap: false,
  legalComments: 'eof'
});
await chmod(new URL('dist/dsa.js', import.meta.url), 0o755);
for (const [name, flags] of [['document', []], ['operations', ['--operations']]]) {
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('dist/dsa.js', import.meta.url)), 'schema', ...flags]);
  await writeFile(new URL(`dist/${name}.schema.json`, import.meta.url), stdout);
}
