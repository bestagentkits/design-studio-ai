import { readFile, writeFile } from 'node:fs/promises';

export class CliError extends Error {
  constructor(public code: string, message: string, public exitCode = 1, public status?: number, public details?: unknown) { super(message); }
}
export interface ClientOptions { url?: string; apiKey?: string; timeout?: string }
export function positiveInteger(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new CliError('invalid_number', 'Expected a positive integer.');
  return Number(value);
}
export function nonnegativeNumber(value: string): number {
  const number = Number(value);
  if (!value.trim() || !Number.isFinite(number) || number < 0) throw new CliError('invalid_number', 'Expected a finite nonnegative number.');
  return number;
}
export async function inputText(path: string): Promise<string> {
  if (path !== '-') return readFile(path, 'utf8');
  if (process.stdin.isTTY) throw new CliError('stdin_required', 'Pipe input into stdin when using --file - or a stdin option.');
  let result = '';
  for await (const chunk of process.stdin) {
    result += chunk.toString();
    if (Buffer.byteLength(result) > 21 * 1024 * 1024) throw new CliError('input_too_large', 'Input exceeds 21 MB.');
  }
  return result;
}
export async function inputJson(path: string): Promise<unknown> {
  try { return JSON.parse(await inputText(path)); }
  catch (error) { if (error instanceof SyntaxError) throw new CliError('invalid_json', 'Input is not valid JSON.'); throw error; }
}
export function output(value: unknown): void { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }
export async function outputFile(path: string | undefined, content: string | Uint8Array, metadata: Record<string, unknown> = {}): Promise<void> {
  if (!path || path === '-') { process.stdout.write(content); if (typeof content === 'string' && !content.endsWith('\n')) process.stdout.write('\n'); return; }
  await writeFile(path, content);
  output({ path, bytes: typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength, ...metadata });
}
export async function secretInput(options: { keyStdin?: boolean; keyEnv?: string }, fallback: string): Promise<string> {
  const value = options.keyStdin ? await inputText('-') : process.env[options.keyEnv ?? fallback];
  if (!value?.trim()) throw new CliError('missing_secret', `Set ${options.keyEnv ?? fallback} or pipe the secret with --key-stdin.`);
  return value.trim();
}
export class Client {
  readonly baseUrl: string;
  private token?: string;
  private timeout: number;
  constructor(options: ClientOptions) {
    let base: URL;
    try { base = new URL(options.url ?? process.env.DESIGN_STUDIO_URL ?? 'https://studio.agentkit.best'); }
    catch { throw new CliError('invalid_url', 'Design Studio URL must be a valid HTTP(S) origin.'); }
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
        (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) {
      throw new CliError('invalid_url', 'Use an HTTPS origin, or HTTP localhost for development, without credentials or a path.');
    }
    this.baseUrl = base.origin;
    this.token = options.apiKey ?? process.env.DESIGN_STUDIO_API_KEY;
    this.timeout = options.timeout ? positiveInteger(options.timeout) : 180000;
  }
  async request(path: string, method = 'GET', body?: unknown, auth = true): Promise<Response> {
    if (!/^\/api\/(?!\/)/.test(path) || path.includes('\\')) throw new CliError('invalid_path', 'API paths must begin with /api/.');
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl || !url.pathname.startsWith('/api/')) throw new CliError('invalid_path', 'API paths must remain inside this server /api/ namespace.');
    if (auth && !this.token) throw new CliError('authentication_required', 'Set DESIGN_STUDIO_API_KEY to an API token from Settings.', 2);
    const headers = new Headers({ Accept: 'application/json' });
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers.set('Content-Type', 'application/json'); payload = JSON.stringify(body); }
    let response: Response;
    try { response = await fetch(url, { method, headers, body: payload, redirect: 'error', signal: AbortSignal.timeout(this.timeout) }); }
    catch { throw new CliError('network_error', 'Request failed or timed out. Check DESIGN_STUDIO_URL and server availability.', 3); }
    if (!response.ok) {
      let envelope: { error?: { code?: string; message?: string; details?: unknown } } = {};
      try { envelope = await response.json(); } catch { /* Do not print unknown proxy HTML or credentials. */ }
      const error = envelope.error;
      const message = typeof error?.message === 'string' ? error.message : `Server returned HTTP ${response.status}.`;
      throw new CliError(error?.code ?? 'http_error', this.redact(message), response.status === 401 || response.status === 403 ? 2 : 1, response.status, error?.details);
    }
    return response;
  }
  async json<T = unknown>(path: string, method = 'GET', body?: unknown, auth = true): Promise<T> {
    const response = await this.request(path, method, body, auth);
    if (response.status === 204) return { ok: true } as T;
    try { return await response.json() as T; }
    catch { throw new CliError('invalid_response', 'Server did not return JSON. Check the server URL.', 3); }
  }
  redact(value: string): string { return this.token ? value.split(this.token).join('[redacted]') : value; }
}
