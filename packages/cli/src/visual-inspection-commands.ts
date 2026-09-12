import type { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { visualInspectionSchema, workspaceInspectionSchema, type VisualInspectionResult } from '../../../src/shared/visual-inspection';
import { Client, CliError, nonnegativeNumber, output } from './client';

const numeric = (value: string | undefined) => value === undefined ? undefined : nonnegativeNumber(value);

function imageBytes(result: VisualInspectionResult): Buffer[] {
  if (!Array.isArray(result.images)) throw new CliError('invalid_response', 'Inspection response has no image list.', 3);
  return result.images.map(image => {
    const bytes = typeof image.data === 'string' ? Buffer.from(image.data, 'base64') : Buffer.alloc(0);
    if (image.mimeType !== 'image/png' || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new CliError('invalid_response', 'Inspection response contains an invalid PNG.', 3);
    }
    return bytes;
  });
}

function validationError(issues: unknown): never {
  throw new CliError('invalid_inspection', 'Invalid visual inspection options. Read command --help for selectors and limits.', 1, undefined, issues);
}

export function registerVisualInspectionCommands(projects: Command, client: () => Client): void {
  projects.command('inspect <id>').description('Render a saved page or paginated project contact sheet; writes one private PNG and JSON metadata')
    .option('--mode <mode>', 'page or overview (default overview)')
    .option('--page <index>', 'Zero-based page index; requires --mode page; excludes --page-id')
    .option('--page-id <id>', 'Saved page ID; requires --mode page; excludes --page')
    .option('--revision <number>', 'Require this positive saved document revision')
    .option('--time <seconds>', 'Sample time 0–3600 (default 0)')
    .option('--offset <number>', 'Overview starting page index (default 0)')
    .option('--limit <number>', 'Overview page count 1–12 (default 6)')
    .option('--columns <number>', 'Overview columns 1–4 (default 3)')
    .option('--tile-size <pixels>', 'Overview tile size 160–800 (default 400)')
    .option('--max-dimension <pixels>', 'Page longest edge 256–2048 (default 1600)')
    .requiredOption('--output <file>', 'PNG destination; stdout is reserved for metadata')
    .action(async (id, options) => {
      if (options.output === '-') throw new CliError('file_required', 'Inspection requires --output FILE.');
      const parsed = visualInspectionSchema.safeParse({
        mode: options.mode, pageId: options.pageId, pageIndex: numeric(options.page), expectedRevision: numeric(options.revision),
        time: numeric(options.time), offset: numeric(options.offset), limit: numeric(options.limit), columns: numeric(options.columns),
        tileSize: numeric(options.tileSize), maxDimension: numeric(options.maxDimension),
      });
      if (!parsed.success) validationError(parsed.error.issues);
      const result = await client().json<VisualInspectionResult>(`/api/projects/${encodeURIComponent(id)}/inspect`, 'POST', parsed.data);
      const bytes = imageBytes(result);
      if (bytes.length !== 1) throw new CliError('invalid_response', 'Project inspection must return exactly one PNG.', 3);
      const path = resolve(options.output);
      await writeFile(path, bytes[0]);
      output({ ...result, images: result.images.map(({ data: _data, ...image }, index) => ({ ...image, path, bytes: bytes[index].byteLength })) });
    });

  projects.command('overview').description('Render paginated covers of your saved projects; writes private PNG files and JSON metadata')
    .option('--offset <number>', 'Starting project offset in ID order (default 0)')
    .option('--limit <number>', 'Project count 1–12 (default 6)')
    .option('--time <seconds>', 'Sample time 0–3600 (default 0)')
    .option('--tile-size <pixels>', 'Cover tile size 160–800 (default 400)')
    .requiredOption('--output-dir <directory>', 'PNG destination directory; created after a successful request')
    .action(async options => {
      if (options.outputDir === '-') throw new CliError('file_required', 'Workspace overview requires --output-dir DIR.');
      const parsed = workspaceInspectionSchema.safeParse({ offset: numeric(options.offset), limit: numeric(options.limit), time: numeric(options.time), tileSize: numeric(options.tileSize) });
      if (!parsed.success) validationError(parsed.error.issues);
      const result = await client().json<VisualInspectionResult>('/api/projects/inspect', 'POST', parsed.data);
      const bytes = imageBytes(result);
      const directory = resolve(options.outputDir);
      const paths = bytes.map((_, index) => join(directory, `workspace-${parsed.data.offset}-${index}.png`));
      if (bytes.length) await mkdir(directory, { recursive: true });
      for (let index = 0; index < bytes.length; index++) await writeFile(paths[index], bytes[index]);
      output({ ...result, images: result.images.map(({ data: _data, ...image }, index) => ({ ...image, path: paths[index], bytes: bytes[index].byteLength })) });
    });
}
