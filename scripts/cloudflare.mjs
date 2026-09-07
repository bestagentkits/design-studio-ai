import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
for (const file of ['.env', 'screenshots.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}
const entry = new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url);
const result = spawnSync(process.execPath, [entry.pathname.replace(/^\/([A-Za-z]:)/, '$1'), ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
