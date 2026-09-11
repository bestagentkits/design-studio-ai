import { z } from 'zod';
import { hasConnectorQueryCredentials } from './connector-url-policy';

export const connectorIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const connectorRevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const connectorHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const connectorTimestampSchema = z.iso.datetime();
export type ConnectorJson = null | boolean | number | string | ConnectorJson[] | { [key: string]: ConnectorJson };

// Validate before serializing: cycles and deeply nested input must fail without a stack overflow.
export function boundedConnectorJson(maxBytes: number, localReferencesOnly = false) {
  return z.custom<ConnectorJson>((value) => {
    const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
    const seen = new Set<object>();
    let count = 0;
    while (stack.length) {
      const entry = stack.pop()!;
      if (++count > 20000 || entry.depth > 32) return false;
      const item = entry.value;
      if (item === null || typeof item === 'boolean') continue;
      if (typeof item === 'number') { if (!Number.isFinite(item)) return false; continue; }
      if (typeof item === 'string') { if (item.length > maxBytes) return false; continue; }
      if (typeof item !== 'object' || seen.has(item)) return false;
      seen.add(item);
      if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return false;
      const entries = Object.entries(item);
      if (entries.length > 20000) return false;
      for (const [key, child] of entries) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) return false;
        if (localReferencesOnly && ['$ref', '$dynamicRef', '$recursiveRef'].includes(key)
          && (typeof child !== 'string' || !child.startsWith('#'))) return false;
        // A remote base URI could turn a fragment reference into a network reference.
        if (localReferencesOnly && key === '$id' && typeof child === 'string' && !child.startsWith('#')) return false;
        stack.push({ value: child, depth: entry.depth + 1 });
      }
    }
    try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maxBytes; }
    catch { return false; }
  }, { message: 'Expected bounded JSON without unsafe keys, cycles or external schema references.' });
}

// Syntax checks only. The dispatcher must additionally enforce public addresses at connection time.
export const connectorEndpointSchema = z.string().max(2048).url().superRefine((value, context) => {
  let url: URL;
  try { url = new URL(value); } catch { return; }
  if (url.protocol !== 'https:' || url.username || url.password || value.includes('#') || /[\x00-\x20\\]/.test(value) || hasConnectorQueryCredentials(url))
    context.addIssue({ code: 'custom', message: 'Use an HTTPS endpoint without credentials or fragment.' });
});

export const connectorPrincipalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('session'), userId: connectorIdSchema, sessionId: connectorIdSchema }),
  z.strictObject({ kind: z.literal('api'), userId: connectorIdSchema, tokenId: connectorIdSchema }),
  z.strictObject({ kind: z.literal('oauth'), userId: connectorIdSchema, clientId: connectorIdSchema, familyId: connectorIdSchema }),
  z.strictObject({ kind: z.literal('webmcp'), userId: connectorIdSchema, projectId: connectorIdSchema, grantId: connectorIdSchema }),
  z.strictObject({ kind: z.literal('run'), userId: connectorIdSchema, projectId: connectorIdSchema, runId: connectorIdSchema }),
]);
export type ConnectorPrincipal = z.infer<typeof connectorPrincipalSchema>;
