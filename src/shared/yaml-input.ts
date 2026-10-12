import { Lexer, isAlias, isNode, isScalar, parseAllDocuments, visit } from 'yaml';

/** YAML composes recursively and costs ~100x the memory of JSON, so it gets a much smaller budget than JSON. */
export const yamlInputMaxBytes = 1024 * 1024;
const maxFlowDepth = 64, maxIndent = 128, maxCompactIndicators = 64;

export class YamlInputError extends Error {
  readonly code = 'invalid_yaml';
  constructor(message: string) { super(message); this.name = 'YamlInputError'; }
}

/** Reject pathological nesting with an iterative scan before the recursive composer runs. */
function assertShallow(text: string): void {
  let depth = 0;
  for (const token of new Lexer().lex(text)) {
    if (token === '[' || token === '{') { if (++depth > maxFlowDepth) throw new YamlInputError(`YAML nesting exceeds ${maxFlowDepth} levels.`); }
    else if (token === ']' || token === '}') depth = Math.max(0, depth - 1);
  }
  for (const line of text.split('\n')) {
    const lead = /^[ \t]*/.exec(line)![0].length;
    if (lead > maxIndent) throw new YamlInputError(`YAML indentation exceeds ${maxIndent} columns.`);
    if ((line.slice(lead).match(/^(?:[-?:](?:\s+|$))+/)?.[0].match(/[-?:]/g)?.length ?? 0) > maxCompactIndicators) throw new YamlInputError(`YAML nesting exceeds ${maxCompactIndicators} levels.`);
  }
}

/**
 * Parse authoring YAML into plain JSON-compatible data. This is only an input convenience: callers must
 * validate the result with the same schemas as JSON input, and storage/responses remain JSON.
 * Accepted subset: one YAML 1.2 document, core-schema scalars, no tags, no anchors/aliases/merge keys,
 * no `__proto__` keys, bounded size and nesting. Merge keys are not expanded (a literal `<<` key is left for
 * schema validation to reject) and keys that stringify identically (`1` and `"1"`) resolve last-wins like JSON.
 */
export function parseYamlInput(text: string): unknown {
  if (new TextEncoder().encode(text).length > yamlInputMaxBytes) throw new YamlInputError('YAML input exceeds 1 MB; send large documents as JSON.');
  assertShallow(text);
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
      if (key === '__proto__') { unsafe = `YAML key "${key}" is not allowed.`; return visit.BREAK; }
    },
  });
  if (unsafe) throw new YamlInputError(unsafe);
  const value = document.toJS({ maxAliasCount: 0 });
  if (value === null || value === undefined) throw new YamlInputError('YAML input is empty.');
  return JSON.parse(JSON.stringify(value));
}

