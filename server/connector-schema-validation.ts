import { boundedConnectorJson } from '../src/shared/connector-values';
import { compileConnectorPattern } from './connector-schema-regex';

export class ConnectorSchemaError extends Error {
  constructor(public readonly code: 'unsupported_schema' | 'invalid_tool_arguments' | 'schema_budget_exceeded', message: string) { super(message); this.name = 'ConnectorSchemaError'; }
}
type Schema = boolean | Record<string, unknown>;
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const annotations = new Set(['title','description','default','examples','deprecated','readOnly','writeOnly','$comment']);
const supported = new Set(['$schema','$ref','$defs','definitions','type','enum','const','allOf','anyOf','oneOf','not','if','then','else','properties','patternProperties','additionalProperties','required','propertyNames','minProperties','maxProperties','dependentRequired','dependentSchemas','prefixItems','items','contains','minContains','maxContains','minItems','maxItems','uniqueItems','minLength','maxLength','pattern','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf']);
const types = new Set(['null','boolean','object','array','number','integer','string']);

/** Explicit 2020-12 subset. Unsupported constraints fail closed; no network, code generation or native schema regex. */
export function inspectConnectorSchema(schema: unknown): void { evaluate(schema, null, {}, true); }
export function validateConnectorArguments(schema: unknown, args: unknown, options: { maxSteps?: number } = {}): true { return evaluate(schema, args, options); }
function evaluate(schema: unknown, args: unknown, options: { maxSteps?: number }, inspectOnly = false): true {
  const unsupported = (message: string): never => { throw new ConnectorSchemaError('unsupported_schema', message); };
  let remaining = Math.max(1, Math.min(100000, options.maxSteps ?? 100000));
  if (!Number.isFinite(remaining)) remaining = 100000;
  const step = (cost = 1) => { remaining -= cost; if (remaining < 0) throw new ConnectorSchemaError('schema_budget_exceeded', 'Schema validation work limit exceeded.'); };
  if (!boundedConnectorJson(65536, true).safeParse(schema).success) unsupported('Schema exceeds structural limits or contains external references.');
  if (!boundedConnectorJson(65536).safeParse(args).success) throw new ConnectorSchemaError('invalid_tool_arguments', 'Arguments exceed JSON structural limits.');
  const keyCache = new WeakMap<object, string[]>();
  const keysOf = (value: object) => {
    let keys = keyCache.get(value);
    if (!keys) { keys = Object.keys(value); keyCache.set(value, keys); }
    step(keys.length); return keys;
  };
  const entriesOf = (value: Record<string, unknown>) => keysOf(value).map(key => [key, value[key]] as const);
  const patterns = new Map<string, (value: string) => boolean>(), prepared = new Set<Schema>();
  const pattern = (value: unknown) => { if (typeof value !== 'string') unsupported('Pattern must be a string.'); const text = value as string;
    if (!patterns.has(text)) patterns.set(text, compileConnectorPattern(text, unsupported, step)); return patterns.get(text)!; };
  const resolve = (ref: unknown): Schema => {
    if (typeof ref !== 'string' || ref !== '#' && !ref.startsWith('#/')) return unsupported('Only local JSON Pointer references are supported.');
    step(ref.length);
    let target: unknown = schema;
    if (ref !== '#') {
      let pointer: string; try { pointer = decodeURIComponent(ref.slice(1)); } catch { return unsupported('Invalid reference encoding.'); }
      for (const segment of pointer.split('/').slice(1)) { step(); if (/~(?![01])/u.test(segment)) unsupported('Invalid JSON Pointer escape.');
        const key = segment.replaceAll('~1','/').replaceAll('~0','~');
        if (target === null || typeof target !== 'object' || !own(target, key)) return unsupported('Unresolved local reference.');
        target = (target as Record<string, unknown>)[key];
      }
    }
    if (typeof target !== 'boolean' && !record(target)) return unsupported('Reference does not identify a schema.');
    return target as Schema;
  };
  function prepare(value: unknown, depth = 0): asserts value is Schema {
    step(); if (depth > 64) unsupported('Schema reference depth exceeds 64.');
    if (typeof value === 'boolean') return;
    if (!record(value)) unsupported('Expected an object or boolean schema.');
    const s = value as Record<string, unknown>; if (prepared.has(s)) return; prepared.add(s);
    for (const [key, child] of entriesOf(s)) {
      step(); if (annotations.has(key)) continue;
      if (!supported.has(key)) unsupported(`Unsupported schema keyword: ${key}.`);
      if (key === '$schema') { if (child !== 'https://json-schema.org/draft/2020-12/schema') unsupported('Only JSON Schema 2020-12 is supported.'); }
      else if (key === '$ref') prepare(resolve(child), depth + 1);
      else if (['$defs','definitions','properties','patternProperties','dependentSchemas'].includes(key)) {
        if (!record(child)) unsupported(`${key} must be a schema map.`);
        for (const [name, nested] of entriesOf(child as Record<string, unknown>)) { if (key === 'patternProperties') pattern(name); prepare(nested, depth + 1); }
      } else if (['allOf','anyOf','oneOf','prefixItems'].includes(key)) {
        if (!Array.isArray(child) || child.length === 0) unsupported(`${key} must be a nonempty schema array.`);
        for (const nested of child as unknown[]) prepare(nested, depth + 1);
      } else if (['not','if','then','else','additionalProperties','propertyNames','items','contains'].includes(key)) prepare(child, depth + 1);
      else if (key === 'type') { const values = Array.isArray(child) ? child : [child]; if (!values.length || new Set(values).size !== values.length || values.some(v => typeof v !== 'string' || !types.has(v))) unsupported('Invalid schema type.'); }
      else if (key === 'required') { if (!Array.isArray(child) || child.some(v => typeof v !== 'string') || new Set(child).size !== child.length) unsupported('required must contain distinct strings.'); }
      else if (key === 'dependentRequired') { if (!record(child)) unsupported('dependentRequired must be a map.'); for (const values of Object.values(child as object)) if (!Array.isArray(values) || values.some(v => typeof v !== 'string') || new Set(values).size !== values.length) unsupported('Invalid dependentRequired property list.'); }
      else if (key === 'enum') { if (!Array.isArray(child) || !child.length) unsupported('enum must be nonempty.'); }
      else if (key === 'pattern') pattern(child);
      else if (key === 'uniqueItems') { if (typeof child !== 'boolean') unsupported('uniqueItems must be boolean.'); }
      else if (key === 'const') continue;
      else if (['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf'].includes(key)) { if (typeof child !== 'number' || !Number.isFinite(child) || key === 'multipleOf' && child <= 0) unsupported(`Invalid ${key}.`); }
      else if (typeof child !== 'number' || !Number.isSafeInteger(child) || child < 0) unsupported(`Invalid ${key}.`);
    }
  }
  prepare(schema);
  // Reject cycles that revisit a schema without descending into a child instance.
  const checking = new Set<Schema>(), checked = new Set<Schema>();
  const checkCycles = (s: Schema, depth = 0) => {
    step(); if (depth > 64) unsupported('Schema reference graph depth exceeds 64.'); if (typeof s === 'boolean' || checked.has(s)) return;
    if (checking.has(s)) unsupported('Non-progressing reference cycle.'); checking.add(s);
    if (own(s,'$ref')) checkCycles(resolve(s.$ref),depth + 1);
    for (const key of ['allOf','anyOf','oneOf']) for (const child of (s[key] as Schema[] | undefined) ?? []) checkCycles(child,depth + 1);
    for (const key of ['not','if','then','else']) if (s[key] !== undefined) checkCycles(s[key] as Schema,depth + 1);
    for (const child of Object.values((s.dependentSchemas as Record<string,Schema> | undefined) ?? {})) checkCycles(child,depth + 1);
    checking.delete(s); checked.add(s);
  };
  for (const node of prepared) checkCycles(node);
  if (inspectOnly) return true;
  const equal = (a: unknown, b: unknown): boolean => {
    step(); if (typeof a === 'string' && typeof b === 'string') step(Math.max(a.length,b.length));
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => equal(value,b[index]));
    if (record(a) && record(b)) { const keys = keysOf(a); return keys.length === keysOf(b).length && keys.every(key => own(b,key) && equal(a[key],b[key])); }
    return false;
  };
  const active = new Map<Schema, Set<unknown>>();
  function validate(s: Schema, value: unknown, depth = 0): boolean {
    step(); if (depth > 64) throw new ConnectorSchemaError('schema_budget_exceeded','Validation depth exceeded.');
    if (typeof s === 'boolean') return s;
    const visits = active.get(s) ?? new Set(); if (visits.has(value)) unsupported('Non-progressing reference cycle.'); visits.add(value); active.set(s, visits);
    try {
      if (own(s,'$ref') && !validate(resolve(s.$ref),value,depth + 1)) return false;
      const check = (nested: unknown, item = value) => validate(nested as Schema,item,depth + 1);
      if (s.type !== undefined) { const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
        if (!(Array.isArray(s.type) ? s.type : [s.type]).some(type => type === actual || type === 'integer' && typeof value === 'number' && Number.isInteger(value))) return false; }
      if (own(s,'const') && !equal(value,s.const) || s.enum && !(s.enum as unknown[]).some(item => equal(value,item))) return false;
      if (s.allOf && !(s.allOf as Schema[]).every(child => check(child))) return false;
      if (s.anyOf && !(s.anyOf as Schema[]).some(child => check(child))) return false;
      if (s.oneOf && (s.oneOf as Schema[]).filter(child => check(child)).length !== 1) return false;
      if (s.not !== undefined && check(s.not)) return false;
      if (s.if !== undefined) { const branch = check(s.if) ? s.then : s.else; if (branch !== undefined && !check(branch)) return false; }
      if (typeof value === 'number') {
        for (const [key, valid] of [['minimum',value >= (s.minimum as number)],['maximum',value <= (s.maximum as number)],['exclusiveMinimum',value > (s.exclusiveMinimum as number)],['exclusiveMaximum',value < (s.exclusiveMaximum as number)]] as const) if (s[key] !== undefined && !valid) return false;
        if (s.multipleOf !== undefined && !decimalMultiple(value,s.multipleOf as number)) return false;
      }
      if (typeof value === 'string') { step(value.length); const length = [...value].length;
        if (s.minLength !== undefined && length < (s.minLength as number) || s.maxLength !== undefined && length > (s.maxLength as number) || s.pattern !== undefined && !pattern(s.pattern)(value)) return false; }
      if (Array.isArray(value)) {
        if (s.minItems !== undefined && value.length < (s.minItems as number) || s.maxItems !== undefined && value.length > (s.maxItems as number)) return false;
        const prefix = s.prefixItems as Schema[] | undefined;
        for (let i=0;i<value.length;i++) { step(); const child = prefix && i < prefix.length ? prefix[i] : s.items; if (child !== undefined && !check(child,value[i])) return false; }
        if (s.uniqueItems) for (let i=0;i<value.length;i++) for (let j=0;j<i;j++) if (equal(value[i],value[j])) return false;
        if (s.contains !== undefined) { let count=0; for (const item of value) if (check(s.contains,item)) count++;
          if (count < (s.minContains as number ?? 1) || s.maxContains !== undefined && count > (s.maxContains as number)) return false; }
      }
      if (record(value)) {
        const keys = keysOf(value), properties = s.properties as Record<string, Schema> | undefined, patternProperties = s.patternProperties as Record<string, Schema> | undefined;
        if (s.minProperties !== undefined && keys.length < (s.minProperties as number) || s.maxProperties !== undefined && keys.length > (s.maxProperties as number)) return false;
        if (s.required && (s.required as string[]).some(key => !own(value,key))) return false;
        for (const key of keys) { step(key.length + 1); if (s.propertyNames !== undefined && !check(s.propertyNames,key)) return false;
          let covered = false; if (properties && own(properties,key)) { covered = true; if (!check(properties[key],value[key])) return false; }
          for (const [expression, child] of entriesOf(patternProperties ?? {})) { step(); if (pattern(expression)(key)) { covered = true; if (!check(child,value[key])) return false; } }
          if (!covered && s.additionalProperties !== undefined && !check(s.additionalProperties,value[key])) return false;
          if (record(s.dependentRequired) && own(s.dependentRequired,key) && (s.dependentRequired[key] as string[]).some(name => !own(value,name))) return false;
          if (record(s.dependentSchemas) && own(s.dependentSchemas,key) && !check(s.dependentSchemas[key])) return false;
        }
      }
      return true;
    } finally { visits.delete(value); }
  }
  if (!validate(schema as Schema,args)) throw new ConnectorSchemaError('invalid_tool_arguments','Arguments do not match the selected tool schema.');
  return true;
}
/** Decimal JSON numbers are checked exactly without floating-point division tolerance. */
function decimalMultiple(value: number, divisor: number) {
  const parts = (number: number) => { const [base, exponent = '0'] = String(number).split('e'), [whole,fraction=''] = base.split('.'); return { integer: BigInt(whole + fraction), scale: fraction.length - Number(exponent) }; };
  const a = parts(value), b = parts(divisor), scale = Math.max(a.scale,b.scale);
  return a.integer * 10n ** BigInt(scale-a.scale) % (b.integer * 10n ** BigInt(scale-b.scale)) === 0n;
}
