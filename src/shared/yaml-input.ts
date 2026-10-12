import { isAlias, isNode, isScalar, parseAllDocuments, visit } from 'yaml';

export const yamlInputMaxBytes = 21 * 1024 * 1024;
export type InputFormat = 'json' | 'yaml';

export class YamlInputError extends Error {
  readonly code = 'invalid_yaml';
  constructor(message: string) { super(message); this.name = 'YamlInputError'; }
}

/**
 * Parse authoring YAML into plain JSON-compatible data. This is only an input convenience: callers must
 * validate the result with the same schemas as JSON input, and storage/responses remain JSON.
 * Accepted subset: one YAML 1.2 document, core-schema scalars, no tags, no anchors/aliases/merge keys,
 * no duplicate keys and no prototype-polluting keys.
 */
export function parseYamlInput(text: string): unknown {
  if (new TextEncoder().encode(text).length > yamlInputMaxBytes) throw new YamlInputError('YAML input exceeds 21 MB.');
  const documents = parseAllDocuments(text, { version: '1.2', schema: 'core', uniqueKeys: true, merge: false, prettyErrors: true, strict: true });
  const parsed = Array.isArray(documents) ? documents : [documents];
  if (!parsed.length) throw new YamlInputError('YAML input is empty.');
  if (parsed.length > 1) throw new YamlInputError('YAML input must contain exactly one document; remove extra --- separators.');
  const document = parsed[0]!;
  const problem = document.errors[0] ?? document.warnings[0];
  if (problem) throw new YamlInputError(`Invalid YAML: ${problem.message.split('\n')[0]}`);
  let unsafe: string | undefined;
  visit(document, {
    Alias: () => { unsafe = 'YAML aliases (*name) are not supported; write repeated values out explicitly.'; return visit.BREAK; },
    Node: (_key, node) => {
      if (isAlias(node)) return;
      if (isNode(node) && (node.anchor || node.tag)) { unsafe = 'YAML anchors (&name) and explicit tags (!tag) are not supported.'; return visit.BREAK; }
      if (isScalar(node) && typeof node.value === 'number' && !Number.isFinite(node.value)) { unsafe = 'YAML .nan/.inf numbers are not valid design values.'; return visit.BREAK; }
    },
    Pair: (_key, pair) => {
      const key = isScalar(pair.key) ? String(pair.key.value) : undefined;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') { unsafe = `YAML key "${key}" is not allowed.`; return visit.BREAK; }
    },
  });
  if (unsafe) throw new YamlInputError(unsafe);
  const value = document.toJS({ maxAliasCount: 0 });
  if (value === null || value === undefined) throw new YamlInputError('YAML input is empty.');
  return JSON.parse(JSON.stringify(value));
}

/** Format-aware parse used by the CLI: JSON stays strict JSON, YAML goes through the safe subset. */
export function parseStructuredInput(text: string, format: InputFormat): unknown {
  return format === 'yaml' ? parseYamlInput(text) : JSON.parse(text);
}
