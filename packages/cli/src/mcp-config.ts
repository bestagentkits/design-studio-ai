// Pure, dependency-free config logic for `dsa mcp install`. Kept separate from the
// commander command so the merge/no-clobber and snippet rules are unit-testable.
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AgentSpec { name: string; path: string; key: string; writeable: boolean; }
export interface McpServerEntry { type: 'http'; url: string; headers?: Record<string, string>; }

const home = () => process.env.HOME || homedir();

// Only shapes verified against an agent's published docs may be written.
// Claude Code HTTP transport, verified against https://code.claude.com/docs/en/mcp:
//   ~/.claude.json → mcpServers.<name> = { type: "http", url, headers }.
// The remaining agents' file envelopes are NOT verified here; `dsa mcp install` prints
// the MCP-standard { type, url, headers } entry plus their config path, and the user
// merges it under the key shown. `--write` only targets the verified Claude Code shape.
export const AGENTS: Record<string, AgentSpec> = {
  claude: { name: 'Claude Code', path: join(home(), '.claude.json'), key: 'mcpServers', writeable: true },
  codex: { name: 'Codex CLI', path: join(home(), '.codex', 'config.toml'), key: 'mcp_servers', writeable: false },
  cursor: { name: 'Cursor', path: join(home(), '.cursor', 'mcp.json'), key: 'mcpServers', writeable: false },
  opencode: { name: 'OpenCode', path: join(home(), '.config', 'opencode', 'opencode.json'), key: 'mcp', writeable: false },
};
export const AGENT_IDS = Object.keys(AGENTS);

export function serverEntry(url: string, token: string): McpServerEntry {
  return { type: 'http', url, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) };
}

export function mcpUrl(origin: string): string {
  const base = new URL(origin);
  if (base.pathname !== '/') throw new Error('Use an origin without a path.');
  return `${base.origin.replace(/\/+$/, '')}/mcp`;
}

// Merge a server entry into an existing JSON config without clobbering an entry
// that already exists under serverName. Returns clobbered=true instead of a merged
// config when the name is taken, so the caller can fail loudly.
export function mergeMcpConfig(existing: string | null, key: string, serverName: string, entry: McpServerEntry): { config: Record<string, unknown>; clobbered: boolean } {
  let config: Record<string, unknown> = {};
  if (existing && existing.trim()) {
    try { config = JSON.parse(existing) as Record<string, unknown>; }
    catch { throw new Error('Existing config is not valid JSON.'); }
  }
  const servers = (config[key] ?? {}) as Record<string, unknown>;
  if (typeof servers !== 'object' || Array.isArray(servers)) throw new Error(`Existing "${key}" is not an object.`);
  if (serverName in servers) return { config, clobbered: true };
  servers[serverName] = entry;
  config[key] = servers;
  return { config, clobbered: false };
}
