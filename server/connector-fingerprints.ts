import { boundedConnectorJson, type ConnectorJson } from '../src/shared/connector-values';

/** Canonical JSON binds approvals to content, independent of object insertion order. */
export function canonicalConnectorJson(value: unknown): string {
  const parsed = boundedConnectorJson(1024 * 1024).parse(value);
  const canonical = (item: ConnectorJson): ConnectorJson => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item !== null && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])]));
    return item;
  };
  return JSON.stringify(canonical(parsed));
}
export async function connectorFingerprint(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalConnectorJson(value)));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}
