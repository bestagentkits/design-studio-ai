import type { Command } from 'commander';
import { telemetryQuerySchema } from '../../../src/shared/observability';
import { Client, output } from './client';
export function registerObservabilityCommands(program: Command, client: () => Client) {
  const group = program.command('observability').description('Inspect account activity, traces and measured provider usage');
  function filters(command: Command) {
    return command.option('--scope <scope>', 'owner (default) or all (configured operator only)')
      .option('--days <days>', 'Look back 1–30 days (default 7)').option('--project-id <id>', 'Filter project')
      .option('--actor-id <id>', 'Filter actor (operator all scope only)').option('--channel <channel>', 'browser, api, oauth, mcp, cli, webmcp, anonymous')
      .option('--kind <kind>', 'http, provider, mcp, client, export').option('--status <status>', 'running, success, error, interrupted')
      .option('--action <action>', 'Exact recorded action');
  }
  const query = (options: Record<string, unknown>) => new URLSearchParams(Object.entries(telemetryQuerySchema.parse(options)).map(([key, value]) => [key, String(value)])).toString();
  filters(group.command('summary').description('Usage, errors, latency, actors and coverage')).action(async options => output(await client().json(`/api/observability/summary?${query(options)}`)));
  filters(group.command('events').description('Paginated activity log')).option('--limit <count>', 'Page size 1–100').option('--cursor <cursor>', 'Cursor returned by previous page')
    .action(async options => output(await client().json(`/api/observability/events?${query(options)}`)));
  group.command('trace <id>').description('Read the correlated steps of a request').option('--scope <scope>', 'owner or all; all requires configured operator').option('--days <days>', 'Look back 1–30 days (default 7)')
    .action(async (id, options) => output(await client().json(`/api/observability/trace/${encodeURIComponent(id)}?${query(options)}`)));
}
