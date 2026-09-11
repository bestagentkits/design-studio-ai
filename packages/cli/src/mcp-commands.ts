import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CliError, output } from './client';
import { AGENTS, AGENT_IDS, mcpUrl, mergeMcpConfig, serverEntry } from './mcp-config';

export function registerMcpCommands(program: Command) {
  const mcp = program.command('mcp').description('Connect coding agents to the Design Studio network MCP server');
  mcp.command('install <agent>')
    .description(`Generate the Design Studio MCP server config for an agent (${AGENT_IDS.join(', ')}). Prints by default; --write persists it (Claude Code only).`)
    .option('--url <origin>', 'Studio server origin; defaults to DESIGN_STUDIO_URL or https://studio.agentkit.best')
    .option('--api-key <token>', 'API token; defaults to DESIGN_STUDIO_API_KEY')
    .option('--name <serverName>', 'MCP server entry name', 'design-studio')
    .option('--write', 'Write into the agent config file (backup first; never clobbers an existing entry)')
    .action(async (agent: string, options: { url?: string; apiKey?: string; name: string; write?: boolean }) => {
      const spec = AGENTS[agent];
      if (!spec) throw new CliError('unknown_agent', `Unknown agent "${agent}". Choose one of: ${AGENT_IDS.join(', ')}.`);
      const origin = options.url ?? process.env.DESIGN_STUDIO_URL ?? 'https://studio.agentkit.best';
      const token = options.apiKey ?? process.env.DESIGN_STUDIO_API_KEY ?? '';
      let url: string;
      try { url = mcpUrl(origin); } catch { throw new CliError('invalid_url', 'Use an origin without a path (e.g. https://studio.agentkit.best).'); }
      const entry = serverEntry(url, token);
      if (!options.write) {
        output({ agent, name: spec.name, url, serverName: options.name, entry, mergeInto: spec.path, key: spec.key, writeable: spec.writeable });
        return;
      }
      if (!spec.writeable) throw new CliError('print_only', `${spec.name} config format is not verified by this CLI; apply the printed snippet under "${spec.key}" in ${spec.path} manually.`, 1);
      if (!token) throw new CliError('missing_secret', 'Set DESIGN_STUDIO_API_KEY or pass --api-key to write a usable config.', 1);
      const existing = existsSync(spec.path) ? await readFile(spec.path, 'utf8') : null;
      let merged: { config: Record<string, unknown>; clobbered: boolean };
      try { merged = mergeMcpConfig(existing, spec.key, options.name, entry); } catch (error) { throw new CliError('invalid_config', error instanceof Error ? error.message : 'Could not read the existing config.'); }
      if (merged.clobbered) throw new CliError('entry_exists', `"${options.name}" already exists in ${spec.path}; it was left unchanged. Use --name to choose another entry name.`, 1);
      if (existing) {
        await rename(spec.path, `${spec.path}.bak`);
      } else {
        const directory = dirname(spec.path);
        if (!existsSync(directory)) await mkdir(directory, { recursive: true });
      }
      await writeFile(spec.path, JSON.stringify(merged.config, null, 2) + '\n');
      output({ agent, name: spec.name, written: spec.path, serverName: options.name, url });
    });
}
