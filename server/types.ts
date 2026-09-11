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
  CONNECTORS_ENABLED?: string;
  CONNECTOR_FETCH?: import('./connector-transport').ConnectorFetch;
  DB: Database;
  ASSETS_BUCKET: Bucket;
  BROWSER?: Parameters<typeof puppeteer.launch>[0]; EXPORT_BROWSER?: () => Promise<import("./exports").ExportBrowser>;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  ENCRYPTION_KEY?: string;
  APP_URL?: string;
  ALLOW_REGISTRATION?: string;
  PROVIDER_ALLOWED_ORIGINS?: string;
  GITHUB_CONNECTOR_CLIENT_ID?: string;
  GITHUB_CONNECTOR_CLIENT_SECRET?: string;
  GITHUB_CONNECTOR_APP_ID?: string;
  GITHUB_CONNECTOR_PRIVATE_KEY?: string;
  GITHUB_CONNECTOR_WEBHOOK_SECRET?: string;
  GOOGLE_CONNECTOR_CLIENT_ID?: string;
  GOOGLE_CONNECTOR_CLIENT_SECRET?: string;
  GOOGLE_PICKER_API_KEY?: string;
  GOOGLE_PICKER_APP_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_FONTS_API_KEY?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_CALLBACK_URL?: string;
  TRUSTED_ORIGINS?: string;
  OBSERVABILITY_ADMIN_IDS?: string;
  POSTHOG_PROJECT_KEY?: string;
  POSTHOG_HOST?: string;
}
export interface User {
  id: string;
  email: string;
  name: string;
}
export type Env = {
  Bindings: Bindings;
  Variables: { principal: import('../src/shared/connector-values').ConnectorPrincipal | null; user: User | null; authMethod: "session" | "token" | null; tokenKind: 'api' | 'oauth' | null; telemetrySpan?: import('./observability').TelemetrySpan; telemetryErrorCode?: string };
};
