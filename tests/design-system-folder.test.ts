import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { secret } from '../server/security';
import type { Bindings } from '../server/types';
import { compileFolderPackage, decompileFolderPackage, parseTokensCss, type FolderPackage } from '../src/shared/design-system-folder';
import type { DesignSystem } from '../src/shared/design-systems';

const folder = (overrides: Partial<FolderPackage> = {}): FolderPackage => ({
  manifest: { id: 'acme-editorial', name: 'Acme Editorial', description: 'A warm editorial brand.', system: 'shadcn', source: { type: 'local' } },
  designMd: '# Acme Editorial\n\n## Color roles\nAccent is a warm amber; body text sits on a cream background with a muted border and spacing rhythm.\n\n## Typography\nHeading and body use the system serif.\n',
  tokensCss: `:root {\n  --bg: #faf7f0;\n  --fg: #1c1a17;\n  --accent: #c2642a;\n  --muted: #6b6259;\n  --border: #e3ddd0;\n  --font-display: "Fraunces", serif;\n  --font-body: "Source Serif 4", serif;\n  --space-1: 4px;\n  --space-2: 8px;\n  --space-3: 16px;\n  --radius: 12px;\n}\n`,
  ...overrides,
});

test('folder packages compile, guard and round-trip deterministically', async t => {
  await t.test('parseTokensCss extracts custom properties and ignores comments', () => {
    const tokens = parseTokensCss(':root { /* comment --nope: red; */ --bg: #fff; --space-2: 8px }');
    assert.deepEqual(tokens, { '--bg': '#fff', '--space-2': '8px' });
  });

  await t.test('compile maps tokens to theme colors, fonts, spacing and radius', () => {
    const result = compileFolderPackage(folder());
    assert.deepEqual(result.findings, []);
    const theme = result.definition.theme;
    assert.equal(theme.colors.background, '#faf7f0');
    assert.equal(theme.colors.text, '#1c1a17');
    assert.equal(theme.colors.accent, '#c2642a');
    assert.equal(theme.colors.primary, '#c2642a'); // fell back to accent
    assert.equal(theme.colors.muted, '#6b6259');
    assert.equal(theme.colors.border, '#e3ddd0');
    assert.equal(theme.fonts.heading, 'Fraunces');
    assert.equal(theme.fonts.body, 'Source Serif 4');
    assert.deepEqual(theme.spacing, [4, 8, 16]);
    assert.equal(theme.radius, 12);
    assert.equal(result.definition.system, 'shadcn');
  });

  await t.test('guard blocks missing required tokens and prose/token mismatches', () => {
    const missing = compileFolderPackage(folder({ tokensCss: ':root { --bg: #fff; --fg: #000; --accent: #333; }' }));
    assert.ok(missing.findings.some(f => f.level === 'error' && f.message.includes('--font-display')), 'missing heading token flagged');
    assert.ok(missing.findings.some(f => f.level === 'error' && f.message.includes('--font-body')), 'missing body token flagged');

    const mismatch = compileFolderPackage(folder({ tokensCss: ':root { --bg: #fff; --fg: #000; --accent: #333; --font-display: "A"; --font-body: "B"; }' }));
    assert.ok(mismatch.findings.some(f => f.level === 'error' && /DESIGN\.md mentions (border|muted|spacing)/.test(f.message)), 'prose mentions a concept without a token');
  });

  await t.test('decompile then compile preserves the theme', () => {
    const original = compileFolderPackage(folder());
    const roundTrip = decompileFolderPackage(original.definition, 'acme-editorial');
    const recompiled = compileFolderPackage(roundTrip);
    assert.deepEqual(recompiled.definition.theme, original.definition.theme);
  });
});

test('the import route compiles folders into owned immutable systems', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-folder-')), db = new SqliteDatabase(join(directory, 'studio.sqlite'));
  const origin = 'https://studio.example', env: Bindings = { DB: db, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), APP_URL: origin, ENCRYPTION_KEY: secret(), ALLOW_REGISTRATION: 'true' };
  const request = (path: string, method = 'GET', body?: unknown, cookie = '') => app.request(origin + path, { method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    const register = await request('/api/auth/register', 'POST', { email: 'folder-owner@studio.test', password: secret() });
    assert.equal(register.status, 201);
    const cookie = register.headers.get('set-cookie')!.split(';')[0];

    const created = await request('/api/design-systems/import', 'POST', folder(), cookie);
    assert.equal(created.status, 201, await created.clone().text());
    const { system, warnings } = await created.json() as { system: DesignSystem; warnings: string[] };
    assert.equal(system.version, 1);
    assert.equal(system.definition.theme.colors.accent, '#c2642a');
    assert.ok(warnings.includes('primary fell back to accent.'));

    const bad = await request('/api/design-systems/import', 'POST', folder({ tokensCss: ':root { --bg: #fff; }' }), cookie);
    assert.equal(bad.status, 422);
    assert.equal((await bad.json() as { error: { code: string } }).error.code, 'invalid_folder');

    const reexport = decompileFolderPackage(system.definition, system.id);
    const reimported = await request('/api/design-systems/import', 'POST', reexport, cookie);
    assert.equal(reimported.status, 201);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
