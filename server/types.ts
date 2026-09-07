import type puppeteer from '@cloudflare/puppeteer';
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
  exec(sql: string): Promise<unknown>;
}
export interface Bucket {
  put(
    key: string,
    data: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string };
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null>;
  delete(key: string): Promise<unknown>;
}
export interface Bindings {
  DB: Database;
  ASSETS_BUCKET: Bucket;
  BROWSER?: Parameters<typeof puppeteer.launch>[0]; EXPORT_BROWSER?: () => Promise<import("./exports").ExportBrowser>;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  ENCRYPTION_KEY?: string;
  APP_URL?: string;
  ALLOW_REGISTRATION?: string;
  PROVIDER_ALLOWED_ORIGINS?: string;
  GOOGLE_CLIENT_ID?: string;
  TRUSTED_ORIGINS?: string;
}
export interface User {
  id: string;
  email: string;
  name: string;
}
export type Env = {
  Bindings: Bindings;
  Variables: { user: User | null; authMethod: "session" | "token" | null; tokenKind: 'api' | 'oauth' | null };
};
