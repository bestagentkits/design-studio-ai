import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { stringify } from 'yaml';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { secret } from '../server/security';
import { createDocument, templates } from '../src/shared/catalog';
import { documentSchema, kinds, type Project } from '../src/shared/schema';
import { operationsSchema } from '../src/shared/operations';
import { parseYamlInput, parseStructuredInput } from '../src/shared/yaml-input';
import type { Bindings } from '../server/types';

const authored = (value: unknown) => stringify(value, { lineWidth: 0 });

test('YAML input becomes the same plain data as JSON and rejects unsafe or ambiguous constructs', () => {
  const document = createDocument('web', 'Equivalence');
  assert.deepEqual(parseYamlInput(authored(document)), JSON.parse(JSON.stringify(document)));
  assert.deepEqual(documentSchema.parse(parseYamlInput(authored(document))), JSON.parse(JSON.stringify(documentSchema.parse(document))));
  assert.deepEqual(parseStructuredInput('{"a":[1,2]}', 'json'), parseYamlInput('{"a":[1,2]}'), 'JSON text is also valid YAML flow syntax');
  assert.deepEqual(parseYamlInput('name: "007"\nflag: yes'), { name: '007', flag: 'yes' }, 'YAML 1.2 core schema: yes is a string, quoted numbers stay strings');
  const rejected: Record<string, RegExp> = {
    'a: [': /Invalid YAML/,
    'a: 1\na: 2': /unique/i,
    'a: 1\n---\nb: 2': /exactly one document/,
    '': /empty/,
    '# only a comment': /empty/,
    'a: &x 1\nb: *x': /anchors|aliases/,
    'a: *x': /Invalid YAML|aliases/,
    'a: !!js/function "x"': /tag/i,
    'a: !!binary aGk=': /tags/,
    'a: .nan': /\.nan/,
    '__proto__: {polluted: true}': /not allowed/,
    'constructor: 1': /not allowed/,
  };
  for (const [input, message] of Object.entries(rejected)) assert.throws(() => parseYamlInput(input), message, JSON.stringify(input));
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  assert.throws(() => parseYamlInput('a: ' + 'x'.repeat(21 * 1024 * 1024)), /21 MB/);
});

test('MCP accepts YAML documents and operations with the same results, errors and protections as JSON', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-yaml-'));
  const database = new SqliteDatabase(':memory:');
  let server: ReturnType<typeof serve> | undefined;
  try {
    for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) await database.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
    const bindings: Bindings = { DB: database, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret() };
    server = serve({ fetch: request => app.fetch(request, bindings), hostname: '127.0.0.1', port: 0 });
    if (!server.listening) await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`; bindings.APP_URL = baseUrl;
    const registration = await fetch(baseUrl + '/api/auth/register', { method: 'POST', headers: { Origin: baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'yaml-authoring@example.test', password: 'Isolated yaml authoring password' }) });
    assert.equal(registration.status, 201);
    const cookie = registration.headers.get('set-cookie')!.split(';')[0];
    const issued = await fetch(baseUrl + '/api/tokens', { method: 'POST', headers: { Origin: baseUrl, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'yaml test' }) });
    const token = (await issued.json() as { token: string }).token;
    let rpcId = 0;
    const rpc = async (method: string, params: unknown) => {
      const response = await fetch(baseUrl + '/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json() as { result: any }).result;
    };
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await rpc('tools/call', { name, arguments: args }) as { isError?: boolean; content: { text: string }[] };
      return { isError: result.isError === true, body: JSON.parse(result.content[0].text) };
    };
    const get = async (id: string) => (await call('get_project', { projectId: id })).body.project as Project;

    const tools = (await rpc('tools/list', {})).tools as { name: string; inputSchema: { properties: Record<string, { description?: string }>; required?: string[] } }[];
    for (const [tool, field] of [['create_project', 'documentYaml'], ['update_document', 'documentYaml'], ['patch_document', 'operationsYaml']] as const) {
      const schema = tools.find(item => item.name === tool)!.inputSchema;
      assert.match(schema.properties[field].description ?? '', /YAML/, `${tool} advertises ${field}`);
      assert.ok(!schema.required?.includes(field.replace('Yaml', '')), `${tool} must not require the JSON field`);
    }
    const resources = (await rpc('resources/list', {})).resources as { uri: string; description: string }[];
    assert.match(resources.find(item => item.uri === 'studio://schema')!.description, /documentYaml/);
    assert.match(resources.find(item => item.uri === 'studio://operations')!.description, /operationsYaml/);

    const document = createDocument('web', 'YAML authored');
    const fromJson = (await call('create_project', { name: 'Same', kind: 'web', document })).body.project as Project;
    const fromYaml = (await call('create_project', { name: 'Same', kind: 'web', documentYaml: authored(document) })).body.project as Project;
    const comparable = (value: Project['document']) => ({ ...value, id: '', metadata: undefined });
    assert.deepEqual(comparable(fromYaml.document), comparable(fromJson.document), 'equivalent YAML and JSON produce the same saved document');

    const textNode = fromYaml.document.pages[0].nodes.find(node => node.type === 'text')!;
    const operations = [{ op: 'update-node', nodeId: textNode.id, changes: { text: 'Patched from YAML' } }, { op: 'rename', name: 'Renamed via YAML' }];
    const patched = await call('patch_document', { projectId: fromYaml.id, expectedRevision: 1, operationsYaml: authored(operations) });
    assert.equal(patched.isError, false, JSON.stringify(patched.body));
    const viaJson = await call('patch_document', { projectId: fromJson.id, expectedRevision: 1, operations });
    const [yamlPatched, jsonPatched] = [patched.body.project as Project, viaJson.body.project as Project];
    assert.equal(yamlPatched.revision, 2);
    assert.deepEqual({ ...comparable(yamlPatched.document), name: '' }, { ...comparable(jsonPatched.document), name: '' });
    assert.equal((await get(fromYaml.id)).name, 'Renamed via YAML');

    const failures: [string, Record<string, unknown>, RegExp][] = [
      ['patch_document', { operationsYaml: 'op: [', expectedRevision: 2 }, /Invalid YAML/],
      ['patch_document', { operationsYaml: '- &a {op: rename, name: x}\n- *a', expectedRevision: 2 }, /anchors|aliases/],
      ['patch_document', { operationsYaml: '- op: rename\n  name: Never saved\n---\n- op: rename\n  name: Other', expectedRevision: 2 }, /exactly one document/],
      ['patch_document', { operationsYaml: '- op: not-an-operation', expectedRevision: 2 }, /does not match the operations schema/],
      ['patch_document', { operationsYaml: authored(operations), operations, expectedRevision: 2 }, /not both/],
      ['patch_document', { expectedRevision: 2 }, /operationsYaml/],
      ['update_document', { documentYaml: authored({ ...document, kind: 'nope' }), expectedRevision: 2 }, /does not match the document schema/],
      ['update_document', { documentYaml: 'name: [', expectedRevision: 2 }, /Invalid YAML/],
      ['update_document', { expectedRevision: 2 }, /documentYaml/],
      ['create_project', { name: 'bad', kind: 'web', documentYaml: 'name: !!js/function x' }, /tag/i],
    ];
    for (const [tool, args, message] of failures) {
      const outcome = await call(tool, { projectId: fromYaml.id, ...args });
      assert.equal(outcome.isError, true, `${tool} ${JSON.stringify(args).slice(0, 60)}`);
      assert.match(outcome.body.error.message, message);
    }
    const listed = (await call('list_projects', {})).body;
    assert.equal(JSON.stringify(listed).includes('"bad"'), false, 'a rejected create must not persist a project');
    assert.equal((await get(fromYaml.id)).revision, 2, 'rejected YAML never mutates the project');

    const replaced = { ...document, name: 'Replaced by YAML', id: fromYaml.id };
    const saved = await call('update_document', { projectId: fromYaml.id, expectedRevision: 2, documentYaml: authored(replaced) });
    assert.equal(saved.isError, false, JSON.stringify(saved.body)); assert.equal(saved.body.project.revision, 3);
    const stale = await call('update_document', { projectId: fromYaml.id, expectedRevision: 2, documentYaml: authored(replaced) });
    assert.equal(stale.isError, true); assert.match(JSON.stringify(stale.body), /revision|conflict/i);
    assert.equal((await get(fromYaml.id)).revision, 3, 'a stale YAML save keeps the committed revision');
    const stalePatch = await call('patch_document', { projectId: fromYaml.id, expectedRevision: 1, operationsYaml: authored([{ op: 'rename', name: 'Lost update' }]) });
    assert.equal(stalePatch.isError, true); assert.equal((await get(fromYaml.id)).name, 'Replaced by YAML');

    const other = await fetch(baseUrl + '/api/auth/register', { method: 'POST', headers: { Origin: baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'yaml-other@example.test', password: 'Another isolated yaml password' }) });
    const otherToken = (await (await fetch(baseUrl + '/api/tokens', { method: 'POST', headers: { Origin: baseUrl, Cookie: other.headers.get('set-cookie')!.split(';')[0], 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'other' }) })).json() as { token: string }).token;
    const foreign = await fetch(baseUrl + '/mcp', { method: 'POST', headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'tools/call', params: { name: 'patch_document', arguments: { projectId: fromYaml.id, expectedRevision: 3, operationsYaml: authored([{ op: 'rename', name: 'Hijacked' }]) } } }) });
    assert.equal((await foreign.json() as any).result.isError, true, 'ownership checks still apply to YAML input');
    assert.equal((await get(fromYaml.id)).name, 'Replaced by YAML');
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    database.close(); await rm(directory, { recursive: true, force: true });
  }
});

test('records JSON versus YAML serialized size for representative documents without assuming YAML is smaller', () => {
  const rows = [...new Map(templates.map(template => [template.kind, template])).values()].map(template => {
    const document = createDocument(template.kind, template.name, template.themeId, template.id);
    const json = JSON.stringify(document), pretty = JSON.stringify(document, null, 2), yaml = authored(document);
    assert.deepEqual(parseYamlInput(yaml), JSON.parse(json), `${template.id} round-trips`);
    assert.ok(documentSchema.safeParse(parseYamlInput(yaml)).success, `${template.id} validates after parsing`);
    const bytes = (text: string) => Buffer.byteLength(text);
    return { template: template.id, kind: template.kind, compactJsonBytes: bytes(json), prettyJsonBytes: bytes(pretty), yamlBytes: bytes(yaml), yamlVsCompact: +(bytes(yaml) / bytes(json)).toFixed(3), yamlVsPretty: +(bytes(yaml) / bytes(pretty)).toFixed(3) };
  });
  assert.ok(rows.length >= 3 && kinds.length >= rows.length);
  const operations = [{ op: 'update-node', nodeId: 'node-1', changes: { text: 'Hello', width: 320 } }, { op: 'rename', name: 'Renamed' }];
  assert.ok(operationsSchema.safeParse(parseYamlInput(authored(operations))).success);
  if (process.env.YAML_AUTHORING_REPORT) console.table(rows);
});
