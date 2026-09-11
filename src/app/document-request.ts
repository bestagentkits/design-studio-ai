import {api} from './api';

export class DocumentRequestTimeout extends Error {
  constructor(public uncertainWrite: boolean) { super(uncertainWrite ? "Document request timed out. The save outcome is unknown; preserve your local edits and reload to reconcile before saving or sharing again." : "Live refresh timed out. Your local edits are preserved; try saving again."); }
}

/** Bound document synchronization without shortening generation or export requests. */
export async function documentRequest<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await api<T>(path, {signal: controller.signal, method: body === undefined ? 'GET' : method,
      ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  } catch (error) {
    if (controller.signal.aborted) throw new DocumentRequestTimeout(body !== undefined);
    throw error;
  } finally { clearTimeout(timer); }
}
