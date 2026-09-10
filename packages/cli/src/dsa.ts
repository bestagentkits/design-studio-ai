import { Command, CommanderError } from 'commander';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { z } from 'zod';
import { documentSchema, kinds, type DesignDocument, type Project, type ProjectKind } from '../../../src/shared/schema';
import { blocks, createBlock, createDocument, templates, themes } from '../../../src/shared/catalog';
import { duplicateDocument, mutateDocument, operationsSchema } from '../../../src/shared/operations';
import { renderHtml, renderSvg } from '../../../src/shared/render';
import { interviewSchema, answerSchema, scopeSchema } from '../../../src/shared/brief';
import { mergeRequestSchema } from '../../../src/shared/collaboration-contract';
import { registerObservabilityCommands } from './observability-commands';
import { registerDesignSystemCommands } from './design-system-commands';
import { Client, CliError, inputJson, inputText, nonnegativeNumber, output, outputFile, positiveInteger, secretInput } from './client';

const program = new Command().name('dsa').description('Design Studio AI: structured design workflows for agents. JSON output by default.')
  .version('0.3.1').option('--url <origin>', 'Server origin; defaults to DESIGN_STUDIO_URL or https://studio.agentkit.best')
  .option('--api-key <token>', 'Stateless API token (prefer DESIGN_STUDIO_API_KEY to avoid shell history)')
  .option('--timeout <milliseconds>', 'Request timeout', '180000').option('--json', 'JSON output (default)')
  .showHelpAfterError(false).exitOverride();
program.configureOutput({ writeErr: () => {} });
const client = () => new Client(program.opts());
registerDesignSystemCommands(program, client);
registerObservabilityCommands(program, client);
const part = (value: string) => encodeURIComponent(value);
const projectPath = (id: string) => `/api/projects/${part(id)}`;
const wrap = (handler: (...args: any[]) => Promise<unknown> | unknown) => async (...args: any[]) => { const value = await handler(...args); if (value !== undefined) output(value); };
async function project(id: string): Promise<Project> { return (await client().json<{ project: Project }>(projectPath(id))).project; }
async function documentInput(file: string): Promise<DesignDocument> {
  const input = await inputJson(file) as any;
  return documentSchema.parse(input?.project?.document ?? input?.document ?? input);
}
function revision(value: string): number { return positiveInteger(value); }
function ensureRevision(current: Project, expected: number): void {
  if (current.revision !== expected) throw new CliError('revision_conflict', `Expected revision ${expected}; current revision is ${current.revision}. Read and reconcile before retrying.`, 1, 409);
}
async function save(id: string, document: DesignDocument, expectedRevision: number): Promise<unknown> {
  return client().json(`${projectPath(id)}/document`, 'PUT', { document: documentSchema.parse(document), expectedRevision });
}
function selectedKind(value: string): ProjectKind {
  if (!(kinds as readonly string[]).includes(value)) throw new CliError('invalid_kind', `Kind must be one of: ${kinds.join(', ')}.`);
  return value as ProjectKind;
}
function selection<T extends { id: string }>(items: T[], id: string): T {
  const item = items.find(entry => entry.id === id);
  if (!item) throw new CliError('not_found', `Unknown catalog ID: ${id}. List the catalog to find valid IDs.`);
  return item;
}

program.command('health').description('Check server health without authentication').action(wrap(() => client().json('/api/health', 'GET', undefined, false)));
program.command('config').description('Read public server configuration; does not save credentials').action(wrap(() => client().json('/api/config', 'GET', undefined, false)));
program.command('schema').description('Print shared JSON Schema; semantic ID/parent/timeline checks also run on writes')
  .option('--operations', 'Print targeted operation schema').action(wrap(options => ({ schema: z.toJSONSchema(options.operations ? operationsSchema : documentSchema), semanticValidation: 'Writes additionally validate unique IDs, same-page acyclic parents, and timeline references.' })));
program.command('catalog').description('List bundled themes, templates, and reusable blocks').action(wrap(() => ({ themes, templates, blocks })));
const themeGroup = program.command('themes').description('Inspect design tokens and palettes');
themeGroup.command('list').action(wrap(() => ({ themes })));
themeGroup.command('get <id>').action(wrap(id => ({ theme: selection(themes, id) })));
const templateGroup = program.command('templates').description('Inspect and instantiate design templates');
templateGroup.command('list').option('--kind <kind>', 'Filter document kind').action(wrap(options => ({ templates: options.kind ? templates.filter(t => t.kind === selectedKind(options.kind)) : templates })));
templateGroup.command('get <id>').action(wrap(id => ({ template: selection(templates, id) })));
templateGroup.command('instantiate <id>').option('--name <name>', 'Document name').option('--theme <id>', 'Theme ID').option('--output <file>', 'Write JSON to file; - for stdout').action(async (id, options) => {
  const template = selection(templates, id);
  if (options.theme) selection(themes, options.theme);
  const document = createDocument(template.kind, options.name ?? template.name, options.theme ?? template.themeId, id);
  await outputFile(options.output, JSON.stringify(documentSchema.parse(document), null, 2));
});
const blockGroup = program.command('blocks').description('Inspect and instantiate reusable node groups');
blockGroup.command('list').action(wrap(() => ({ blocks: blocks.map(({ nodes, ...block }) => ({ ...block, nodeCount: nodes.length })) })));
blockGroup.command('get <id>').option('--offset <pixels>', 'Vertical offset', '0').action(wrap((id, options) => { selection(blocks, id); return { nodes: createBlock(id, nonnegativeNumber(options.offset)) }; }));

const projects = program.command('projects').description('Manage persisted projects');
const briefs = program.command('brief').description('Persist an interview and explicitly approve its design scope');
briefs.command('get <id>').action(wrap(id => client().json(`${projectPath(id)}/brief`)));
briefs.command('put <id>').description('Create/update from JSON: request, interview, answers, scope; every write invalidates approval').requiredOption('--revision <number>', 'Expected brief revision; 0 creates').requiredOption('--file <path>', 'Brief update JSON or - for stdin').action(wrap(async (id, options) => {
  const expectedRevision = Number(options.revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new CliError('invalid_revision', 'Brief revision must be a nonnegative integer.');
  const body = z.object({request:z.string().trim().min(1).max(12000).optional(), interview:interviewSchema.optional(), answers:answerSchema.optional(), scope:scopeSchema.optional()}).strict().parse(await inputJson(options.file));
  return client().json(`${projectPath(id)}/brief`, 'PUT', {...body,expectedRevision});
}));
briefs.command('interview <id>').description('Ask a configured BYOK provider for contextual questions or scope; incurs provider usage').requiredOption('--revision <number>', 'Expected brief revision').requiredOption('--provider <name>', 'openai, anthropic, gemini, openrouter, deepseek or custom-<slug>').option('--model <id>', 'Provider model override').action(wrap((id, options) => client().json(`${projectPath(id)}/brief/interview`, 'POST', {expectedRevision:revision(options.revision),provider:options.provider,model:options.model})));
briefs.command('approve <id>').description('Approve the reviewed scope after explicit human confirmation; no generation or publication').requiredOption('--revision <number>', 'Expected brief revision').action(wrap((id, options) => client().json(`${projectPath(id)}/brief/approve`, 'POST', {expectedRevision:revision(options.revision)})));
projects.command('list').option('--query <text>', 'Search name/description').option('--kind <kind>', 'Filter document kind').option('--sort <sort>', 'updated, created, or name', 'updated').action(wrap(options => {
  if (!['updated', 'created', 'name'].includes(options.sort)) throw new CliError('invalid_sort', 'Sort must be updated, created, or name.');
  const query = new URLSearchParams({ sort: options.sort });
  if (options.query) query.set('q', options.query);
  if (options.kind) query.set('kind', selectedKind(options.kind));
  return client().json(`/api/projects?${query}`);
}));
projects.command('get <id>').action(wrap(id => client().json(projectPath(id))));
projects.command('check <id>').description('Read-only preflight with node IDs, severity and actionable design checks').action(wrap(id => client().json(`${projectPath(id)}/checks`)));
projects.command('create').requiredOption('--name <name>', 'Project name').option('--description <text>', 'Project description', '').option('--kind <kind>', 'Document kind').option('--template <id>', 'Template ID').option('--theme <id>', 'Theme ID').option('--file <path>', 'Document JSON file or - for stdin').action(wrap(async options => {
  if (options.file && options.template) throw new CliError('conflicting_options', 'Choose either --file or --template.');
  const template = options.template ? selection(templates, options.template) : undefined;
  const document = options.file ? await documentInput(options.file) : undefined;
  const kind = selectedKind(options.kind ?? document?.kind ?? template?.kind ?? 'web');
  if (document && document.kind !== kind || template && template.kind !== kind) throw new CliError('kind_mismatch', 'Requested kind must match the document or template.');
  if (options.theme) selection(themes, options.theme);
  return client().json('/api/projects', 'POST', { name: options.name, description: options.description, kind, document: document ?? createDocument(kind, options.name, options.theme ?? template?.themeId, template?.id) });
}));
projects.command('rename <id> <name>').requiredOption('--revision <number>', 'Revision observed when reading').action(wrap(async (id, name, options) => {
  const current = await project(id); const expected = revision(options.revision); ensureRevision(current, expected);
  return save(id, mutateDocument(current.document, [{ op: 'rename', name }]), expected);
}));
projects.command('delete <id>').description('Delete a project and its stored assets').action(wrap(id => client().json(projectPath(id), 'DELETE')));
projects.command('clone <id>').option('--name <name>', 'Name for the new project').action(wrap(async (id, options) => {
  const source = await project(id);
  return client().json('/api/projects', 'POST', { name: options.name ?? `${source.name} copy`, description: source.description, kind: source.kind, document: duplicateDocument(source.document, options.name) });
}));
const documents = projects.command('document').description('Read and write the canonical design document');
documents.command('merge <id>').description('Merge edits against the actual base you read; overlapping changes return conflict').requiredOption('--file <path>', 'JSON {base,document,baseRevision}, or - for stdin').action(wrap(async (id, options) => client().json(`${projectPath(id)}/merge`, 'POST', mergeRequestSchema.parse(await inputJson(options.file)))));
documents.command('changes <id>').option('--since <revision>', 'Last observed revision', '0').action(wrap((id, options) => client().json(`${projectPath(id)}/changes?since=${nonnegativeNumber(options.since)}`)));
documents.command('get <id>').option('--output <file>', 'Save document JSON to a file').action(async (id, options) => { await outputFile(options.output, JSON.stringify((await project(id)).document, null, 2)); });
documents.command('put <id>').requiredOption('--file <path>', 'Document JSON or - for stdin').requiredOption('--revision <number>', 'Expected saved revision').action(wrap(async (id, options) => save(id, await documentInput(options.file), revision(options.revision))));
documents.command('patch <id>').description('Apply shared targeted operations; reuses atomic revision-checked save').requiredOption('--file <path>', 'Operations array JSON or - for stdin').requiredOption('--revision <number>', 'Expected saved revision').action(wrap(async (id, options) => {
  const operations = operationsSchema.parse(await inputJson(options.file)); const expected = revision(options.revision);
  const current = await project(id); ensureRevision(current, expected);
  return save(id, mutateDocument(current.document, operations), expected);
}));
projects.command('import').description('Create a new project from canonical JSON').requiredOption('--file <path>', 'Document JSON or - for stdin').option('--name <name>', 'Override project name').action(wrap(async options => {
  const document = await documentInput(options.file);
  return client().json('/api/projects', 'POST', { name: options.name ?? document.name, kind: document.kind, document });
}));

projects.command('export <id>').description('Export through the authenticated server renderer').requiredOption('--format <format>', 'json, html, svg, png, pdf, pptx, webm, mp4, react (ZIP), glb, or gltf').option('-o, --output <file>', 'Output filename; required for binary formats').option('--out <file>', 'Alias for --output').option('--page <index>', 'Zero-based page for single-page exports', '0').option('--revision <number>', 'Require the saved revision to match').action(async (id, options) => {
  if (!['json', 'html', 'svg', 'png', 'pdf', 'pptx', 'webm', 'mp4', 'react', 'glb', 'gltf'].includes(options.format)) throw new CliError('unsupported_format', 'Formats: json, html, svg, png, pdf, pptx, webm, mp4, react, glb, gltf. Use google-slides for Google Slides.');
  const destination = options.output ?? options.out;
  const binary = !['json', 'html', 'svg', 'gltf'].includes(options.format);
  if (binary && (!destination || destination === '-')) throw new CliError('file_required', 'Binary exports require --output FILE.');
  const page = nonnegativeNumber(options.page);
  if (!Number.isInteger(page)) throw new CliError('invalid_page', 'Page must be a zero-based integer.');
  const response = await client().request(`${projectPath(id)}/export`, 'POST', { format: options.format, pageIndex: page, ...(options.revision ? { expectedRevision: revision(options.revision) } : {}) });
  const content = binary ? new Uint8Array(await response.arrayBuffer()) : await response.text();
  await outputFile(destination, content, { format: options.format, mimeType: response.headers.get('Content-Type') });
});
program.command('render').description('Render a local JSON document offline using shared static HTML/SVG rendering').requiredOption('--file <path>', 'Document JSON or - for stdin').requiredOption('--format <format>', 'json, html, or svg').option('--output <file>', 'Output filename; omitted writes content to stdout').option('--page <index>', 'Zero-based SVG page', '0').option('--time <seconds>', 'SVG timeline position', '0').action(async options => {
  if (!['json', 'html', 'svg'].includes(options.format)) throw new CliError('unsupported_format', 'Offline rendering supports json, html, or svg. Use projects export for cloud-rendered binary formats.');
  const document = await documentInput(options.file); const page = nonnegativeNumber(options.page);
  if (!Number.isInteger(page)) throw new CliError('invalid_page', 'Page must be a zero-based integer.');
  const content = options.format === 'json' ? JSON.stringify(document, null, 2) : options.format === 'html' ? renderHtml(document) : renderSvg(document, page, nonnegativeNumber(options.time));
  await outputFile(options.output, content, { format: options.format });
});

const assets = program.command('assets').description('Manage stored assets independently of document node placement');
assets.command('list <project-id>').action(wrap(id => client().json(`${projectPath(id)}/assets`)));
const mimes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.glb': 'model/gltf-binary' };
assets.command('upload <project-id>').requiredOption('--file <path>', 'Asset file path').option('--mime <type>', 'MIME type override').action(wrap(async (id, options) => {
  const bytes = await readFile(options.file); if (bytes.length > 20 * 1024 * 1024) throw new CliError('asset_too_large', 'Assets must be at most 20 MB.');
  const mime = options.mime ?? mimes[extname(options.file).toLowerCase()]; if (!mime) throw new CliError('unknown_media_type', 'Unsupported file extension; supply a supported --mime type.');
  const form = new FormData(); form.set('file', new File([bytes], basename(options.file), { type: mime }));
  return client().json(`${projectPath(id)}/assets`, 'POST', form);
}));
assets.command('download <asset-id>').requiredOption('--output <file>', 'Output file').action(async (id, options) => {
  if (options.output === '-') throw new CliError('file_required', 'Download requires a filename so binary output cannot corrupt JSON streams.');
  const response = await client().request(`/api/assets/${part(id)}`);
  await outputFile(options.output, new Uint8Array(await response.arrayBuffer()), { mimeType: response.headers.get('Content-Type') });
});

async function promptText(options: { prompt?: string; promptFile?: string }): Promise<string> {
  if (Boolean(options.prompt) === Boolean(options.promptFile)) throw new CliError('prompt_required', 'Supply exactly one of --prompt or --prompt-file.');
  return options.promptFile ? inputText(options.promptFile) : options.prompt!;
}
program.command('generate <project-id>').description('Generate a document proposal without saving it').requiredOption('--provider <id>', 'openai, anthropic, gemini, openrouter, deepseek or custom-<slug>').requiredOption('--revision <number>', 'Expected current revision').option('--model <id>', 'Model override').option('--prompt <text>', 'Design request').option('--prompt-file <path>', 'Prompt file or - for stdin').option('--output <file>', 'Save proposal JSON').action(async (id, options) => {
  const response = await client().json(`${projectPath(id)}/generate`, 'POST', { provider: options.provider, model: options.model, expectedRevision: revision(options.revision), prompt: await promptText(options) });
  if (options.output) await outputFile(options.output, JSON.stringify(response, null, 2)); else output(response);
});
const providers = program.command('providers').description('Configure BYOK providers; raw secrets never returned by list');
providers.command('models <provider>').option('--query <text>', 'Model search').action(wrap((provider, options) => client().json(`/api/providers/${part(provider)}/models` + (options.query ? `?q=${encodeURIComponent(options.query)}` : ''))));
providers.command('list').action(wrap(() => client().json('/api/providers')));
providers.command('set <provider>')
  .option('--key-env <variable>', 'Environment variable containing provider credential; Basic uses username:password')
  .option('--key-stdin', 'Read provider credential from stdin').option('--keep-key', 'Keep the saved credential when updating metadata')
  .option('--base-url <url>', 'Operator-allowlisted HTTPS API root').option('--model <id>', 'Default model')
  .option('--name <name>', 'Custom provider display name (ID must be custom-<slug>)')
  .option('--protocol <format>', 'Custom API format: openai, anthropic or gemini')
  .option('--auth-method <method>', 'Custom authentication: bearer, api-key, basic or none')
  .option('--auth-header <name>', 'Custom API key header, e.g. X-API-Key')
  .action(wrap(async (provider, options) => {
    if ((options.keepKey || options.authMethod === 'none') && (options.keyEnv || options.keyStdin)) throw new CliError('invalid_options', 'Choose credential input or --keep-key/--auth-method none, not both.');
    return client().json(`/api/providers/${part(provider)}`, 'PUT', {
      apiKey: options.keepKey || options.authMethod === 'none' ? undefined : await secretInput(options, `${provider.toUpperCase().replaceAll('-', '_')}_API_KEY`),
      baseUrl: options.baseUrl, model: options.model, name: options.name, protocol: options.protocol, authMethod: options.authMethod, authHeader: options.authHeader,
    });
  }));
providers.command('remove <provider>').action(wrap(provider => client().json(`/api/providers/${part(provider)}`, 'DELETE')));
const tokens = program.command('tokens').description('Create and revoke API tokens');
tokens.command('list').action(wrap(() => client().json('/api/tokens')));
tokens.command('create').requiredOption('--name <name>', 'Token label').action(wrap(options => client().json('/api/tokens', 'POST', { name: options.name })));
tokens.command('revoke <id>').action(wrap(id => client().json(`/api/tokens/${part(id)}`, 'DELETE')));
program.command('publish <project-id>').description('Create a public frozen snapshot').action(wrap(id => client().json(`${projectPath(id)}/publish`, 'POST')));
program.command('unpublish <project-id>').description('Remove all public snapshots for a project').action(wrap(id => client().json(`${projectPath(id)}/publish`, 'DELETE')));
program.command('preview <project-id>').description('Create a public preview snapshot and return its URL').action(wrap(id => client().json(`${projectPath(id)}/preview`, 'POST')));
program.command('unpreview <project-id>').description('Remove all public snapshots for a project (preview alias)').action(wrap(id => client().json(`${projectPath(id)}/preview`, 'DELETE')));
program.command('share <project-id>').description('Create a public share snapshot and return its URL').action(wrap(id => client().json(`${projectPath(id)}/share`, 'POST')));
program.command('unshare <project-id>').description('Remove all public snapshots for a project (share alias)').action(wrap(id => client().json(`${projectPath(id)}/share`, 'DELETE')));
const media = program.command('media').description('Generate provider image/audio/video assets');
media.command('generate <project-id>').requiredOption('--kind <kind>', 'image, audio, or video').requiredOption('--provider <id>', 'openai, gemini, leonardo, grok or custom-<slug> for images; openai speech; fal media').option('--model <id>', 'Model override').option('--voice <id>', 'Audio voice').option('--source-asset <id>', 'Owned source asset for editing or transformation').option('--duration <seconds>', 'Generated media duration').option('--strength <number>', 'Transformation strength from 0 to 1').option('--prompt <text>', 'Media description or speech text').option('--prompt-file <path>', 'Prompt file or - for stdin').action(wrap(async (id, options) => client().json(`${projectPath(id)}/media`, 'POST', { kind: options.kind, provider: options.provider, model: options.model, voice: options.voice, sourceAssetId: options.sourceAsset, durationSeconds: options.duration ? positiveInteger(options.duration) : undefined, strength: options.strength === undefined ? undefined : nonnegativeNumber(options.strength), prompt: await promptText(options) })));
media.command('status <project-id> <job-id>').action(wrap((id, jobId) => client().json(`${projectPath(id)}/media/${part(jobId)}`)));
program.command('google-slides <project-id>').description('Create a real Google Slides presentation using a short-lived Google OAuth token').option('--key-env <variable>', 'Google access token variable', 'GOOGLE_ACCESS_TOKEN').option('--key-stdin', 'Read Google access token from stdin').action(wrap(async (id, options) => client().json(`${projectPath(id)}/google-slides`, 'POST', { accessToken: await secretInput(options, 'GOOGLE_ACCESS_TOKEN') })));
program.command('api <method> <path>').description('Explicit REST escape hatch restricted to this origin /api/ routes').option('--file <path>', 'JSON request body file or - for stdin').action(wrap(async (method, path, options) => {
  const verb = method.toUpperCase(); if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(verb)) throw new CliError('invalid_method', 'Unsupported HTTP method.');
  if (['GET', 'HEAD'].includes(verb) && options.file) throw new CliError('invalid_body', 'GET and HEAD cannot include a JSON body.');
  if (verb === 'HEAD') { const response = await client().request(path, verb); return { status: response.status, headers: Object.fromEntries(response.headers.entries()) }; }
  return client().json(path, verb, options.file ? await inputJson(options.file) : undefined);
}));

try { await program.parseAsync(process.argv); }
catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) process.exitCode = 0;
  else {
    const cliError = error instanceof CliError ? error : error instanceof z.ZodError
      ? new CliError('invalid_document', 'Document or operation validation failed.', 1, undefined, error.issues.map(issue => ({ path: issue.path, message: issue.message })))
      : error instanceof CommanderError ? new CliError('invalid_command', error.message.replace(/^error: /, ''))
      : new CliError('runtime_error', error instanceof Error ? error.message : 'Unexpected CLI error.', 4);
    let message = cliError.message;
    for (const value of [process.env.DESIGN_STUDIO_API_KEY, program.opts().apiKey]) if (value) message = message.split(value).join('[redacted]');
    process.stderr.write(JSON.stringify({ error: { code: cliError.code, message, ...(cliError.status ? { status: cliError.status } : {}), ...(cliError.details ? { details: cliError.details } : {}) } }) + '\n');
    process.exitCode = cliError.exitCode;
  }
}
