import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mcpUrl, mergeMcpConfig, serverEntry } from '../packages/cli/src/mcp-config';

const executable = resolve('packages/cli/dist/dsa.js');

function runNode(script: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolveRun => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('close', code => resolveRun({ code: code ?? -1, stdout, stderr }));
  });
}
const run = (args: string[], env: Record<string, string> = {}) => runNode(executable, args, env);

before(async () => {
  const built = await runNode(resolve('packages/cli/build.mjs'), []);
  assert.equal(built.code, 0, built.stderr);
});

test('mergeMcpConfig merges, preserves, and never clobbers', () => {
  const entry = serverEntry('https://studio.agentkit.best/mcp', 'dsa_tok');
  const merged = mergeMcpConfig(JSON.stringify({ mcpServers: { other: { type: 'http', url: 'https://other' } } }), 'mcpServers', 'design-studio', entry);
  assert.equal(merged.clobbered, false);
  assert.ok((merged.config.mcpServers as Record<string, unknown>).other);
  assert.deepEqual((merged.config.mcpServers as Record<string, unknown>)['design-studio'], entry);
  const empty = mergeMcpConfig(null, 'mcpServers', 'design-studio', entry);
  assert.equal(empty.clobbered, false);
  const clobber = mergeMcpConfig(JSON.stringify({ mcpServers: { 'design-studio': {} } }), 'mcpServers', 'design-studio', entry);
  assert.equal(clobber.clobbered, true);
  assert.throws(() => mergeMcpConfig('{not json', 'mcpServers', 'x', entry), /not valid JSON/);
});

test('mcpUrl and server entries are deterministic', () => {
  assert.equal(mcpUrl('https://studio.agentkit.best'), 'https://studio.agentkit.best/mcp');
  assert.throws(() => mcpUrl('https://x.example/with/path'));
  assert.deepEqual(serverEntry('https://studio.agentkit.best/mcp', 'dsa_tok'), { type: 'http', url: 'https://studio.agentkit.best/mcp', headers: { Authorization: 'Bearer dsa_tok' } });
  assert.deepEqual(serverEntry('https://studio.agentkit.best/mcp', ''), { type: 'http', url: 'https://studio.agentkit.best/mcp' });
});

test('mcp install prints by default and writes with backup and no-clobber', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsa-mcp-'));
  const env = { HOME: home, DESIGN_STUDIO_URL: 'https://studio.agentkit.best', DESIGN_STUDIO_API_KEY: 'dsa_test_token' };
  try {
    const print = await run(['mcp', 'install', 'claude'], env);
    assert.equal(print.code, 0, print.stderr);
    const snippet = JSON.parse(print.stdout);
    assert.equal(snippet.url, 'https://studio.agentkit.best/mcp');
    assert.equal(snippet.entry.headers.Authorization, 'Bearer dsa_test_token');
    assert.equal(existsSync(join(home, '.claude.json')), false, 'print mode writes nothing');

    const configPath = join(home, '.claude.json');
    const pre = { mcpServers: { other: { type: 'http', url: 'https://other' } } };
    await writeFile(configPath, JSON.stringify(pre));

    const first = await run(['mcp', 'install', 'claude', '--write'], env);
    assert.equal(first.code, 0, first.stderr);
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    assert.ok(config.mcpServers.other, 'existing entry preserved');
    assert.ok(config.mcpServers['design-studio'], 'new entry added');
    assert.equal(config.mcpServers['design-studio'].url, 'https://studio.agentkit.best/mcp');
    assert.ok(existsSync(`${configPath}.bak`), 'backup created');
    assert.deepEqual(JSON.parse(await readFile(`${configPath}.bak`, 'utf8')), pre);

    const second = await run(['mcp', 'install', 'claude', '--write'], env);
    assert.equal(second.code, 1);
    assert.match(second.stderr, /already exists/);
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), config, 'refused write leaves config unchanged');

    const codex = await run(['mcp', 'install', 'codex'], env);
    assert.equal(codex.code, 0);
    const codexSnippet = JSON.parse(codex.stdout);
    assert.equal(codexSnippet.writeable, false);
    assert.equal(codexSnippet.key, 'mcp_servers');
    assert.equal(codexSnippet.entry.type, 'http');
    const codexWrite = await run(['mcp', 'install', 'codex', '--write'], env);
    assert.equal(codexWrite.code, 1);
    assert.match(codexWrite.stderr, /not verified/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
