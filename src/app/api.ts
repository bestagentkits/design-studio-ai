import type { AuthMethod, ProviderProtocol } from '../shared/providers';
import { trackClient, trackClientFailure } from './analytics';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = "request_failed",
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  }).catch(error => {
    if (!path.startsWith('/api/observability/')) trackClientFailure(undefined, true);
    throw error;
  });
  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string; code?: string };
  } | null;
  if (!response.ok) {
    const requestId = response.headers.get('X-Request-ID') ?? undefined;
    if (!path.startsWith('/api/observability/')) trackClientFailure(requestId);
    throw new ApiError(
      data?.error?.message ||
        `Request failed (${response.status}). Please try again.`,
      response.status,
      data?.error?.code,
      requestId,
    );
  }
  const method = options.method ?? 'GET';
  const projectMatch = /^\/api\/projects\/([^/?]+)(?:\/|$)/.exec(path);
  const projectId = projectMatch?.[1];
  if (method === 'POST' && path === '/api/projects') {
    const created = data as { project?: { id?: string } } | null;
    if (created?.project?.id) void trackClient({ event: 'project_create', projectId: created.project.id, outcome: 'success' });
  } else if (projectId && method !== 'GET') {
    const event = /\/(document|merge)$/.test(path) ? 'project_save' : /\/generate$/.test(path) ? 'generation_finish' : /\/export$/.test(path) ? 'export_finish' : null;
    if (event) void trackClient({ event, projectId, outcome: 'success', ...(response.headers.get('X-Request-ID') ? { requestId: response.headers.get('X-Request-ID')! } : {}) });
  }
  return data as T;
}
export function post<T>(path: string, body: unknown = {}): Promise<T> {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) });
}
export function put<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "PUT", body: JSON.stringify(body) });
}
export function message(error: unknown) {
  if (error instanceof ApiError && error.requestId) return `${error.message} (Request ${error.requestId})`;
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
export function uid() {
  return crypto.randomUUID();
}
export function clone<T>(value: T): T {
  return structuredClone(value);
}
export function download(name: string, content: BlobPart | Blob, type: string) {
  const url = URL.createObjectURL(
    content instanceof Blob ? content : new Blob([content], { type }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export type Provider = {
  name?: string;
  protocol?: ProviderProtocol;
  authMethod?: AuthMethod;
  authHeader?: string;
  provider: string;
  configured: boolean;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
};
export type User = { id: string; name: string; email: string };
