import type { Command } from 'commander';
import { designSystemSchema } from '../../../src/shared/design-systems';
import { Client, inputJson, output, positiveInteger } from './client';
export function registerDesignSystemCommands(program: Command, client: () => Client) {
  const path = (id: string) => `/api/design-systems/${encodeURIComponent(id)}`;
  const print = (fn: (...args: any[]) => Promise<unknown>) => async (...args: any[]) => output(await fn(...args));
  const systems = program.command('design-systems').description('Create, version, apply and reuse design libraries');
  systems.command('schema').action(() => output(designSystemSchema.toJSONSchema()));
  systems.command('list').action(print(() => client().json('/api/design-systems')));
  systems.command('get <id>').option('--system-version <number>', 'Pinned immutable version').action(print((id, options) => client().json(path(id) + (options.systemVersion ? `?version=${positiveInteger(options.systemVersion)}` : ''))));
  systems.command('versions <id>').action(print(id => client().json(path(id) + '/versions')));
  systems.command('create').requiredOption('--file <path>', 'Definition JSON or - for stdin').action(print(async options => client().json('/api/design-systems', 'POST', designSystemSchema.parse(await inputJson(options.file)))));
  systems.command('update <id>').requiredOption('--system-version <number>', 'Latest observed version; conflicts are never retried').requiredOption('--file <path>', 'Definition JSON or - for stdin').action(print(async (id, options) => client().json(path(id), 'PUT', { expectedVersion: positiveInteger(options.systemVersion), definition: designSystemSchema.parse(await inputJson(options.file)) })));
  systems.command('apply <id> <project-id>').requiredOption('--revision <number>', 'Observed project revision').option('--system-version <number>', 'Saved system version').action(print((id, projectId, options) => client().json(path(id) + '/apply', 'POST', { projectId, expectedRevision: positiveInteger(options.revision), version: options.systemVersion ? positiveInteger(options.systemVersion) : undefined })));
  systems.command('insert <id> <project-id>').requiredOption('--revision <number>', 'Observed project revision').requiredOption('--page <id>', 'Destination page').requiredOption('--item <id>', 'Component/composition ID').option('--system-version <number>', 'Saved system version').action(print((id, projectId, options) => client().json(path(id) + '/insert', 'POST', { projectId, pageId: options.page, itemId: options.item, expectedRevision: positiveInteger(options.revision), version: options.systemVersion ? positiveInteger(options.systemVersion) : undefined })));
  systems.command('remove <id>').action(print(id => client().json(path(id), 'DELETE')));
  program.command('fonts').description('Search Google Fonts catalog').option('--query <text>', 'Family search').action(print(options => client().json('/api/fonts' + (options.query ? `?q=${encodeURIComponent(options.query)}` : ''))));
}
