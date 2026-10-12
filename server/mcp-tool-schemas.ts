import { z } from 'zod';

// Tool discovery must stay small enough for hosted MCP clients (ChatGPT rejected a 1 MB catalog).
// Arguments whose JSON Schema exceeds this size are advertised as a typed placeholder and validated
// against the complete shared schema before the handler runs; get_tool_schema returns the full schema.
export const compactSchemaBytes = 4096;
// get_tool_schema answers within this size; larger schemas are outlined and read by JSON Pointer.
export const schemaResponseBytes = 16384;
const outlineChildBytes = 1024;

type Shape = Record<string, z.ZodType>;
type Json = Record<string, unknown>;
type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
export interface CompactedTool { advertised: Shape; full: Shape; heavy: string[] }

const isShape = (value: unknown): value is Shape =>
  !!value && typeof value === 'object' && !(value instanceof z.ZodType) && Object.values(value).every(item => item instanceof z.ZodType);
const isJson = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);

// Shared schemas are module constants, while a server is built per request, so conversions are cached by
// identity. Tools wrap them with .optional(), which allocates per request, so the inner schema is the key.
const cacheKey = (schema: z.ZodType): z.ZodType => schema instanceof z.ZodOptional && schema.description === undefined ? cacheKey(schema.unwrap() as z.ZodType) : schema;
const jsonSchemas = new WeakMap<z.ZodType, { schema: Json; bytes: number }>();
function converted(schema: z.ZodType) {
  const key = cacheKey(schema);
  let entry = jsonSchemas.get(key);
  if (!entry) {
    const json = z.toJSONSchema(key, { io: 'input', unrepresentable: 'any' }) as Json;
    entry = { schema: json, bytes: JSON.stringify(json).length };
    jsonSchemas.set(key, entry);
  }
  return entry;
}
export const inputJsonSchema = (schema: z.ZodType) => converted(schema).schema;

const placeholders = new WeakMap<z.ZodType, Map<string, z.ZodType>>();
function placeholder(tool: string, key: string, schema: z.ZodType): z.ZodType {
  const id = `${tool}\u0000${key}`;
  const inner = cacheKey(schema);
  const cached = placeholders.get(inner)?.get(id);
  if (cached) return schema.isOptional() ? cached.optional() : cached;
  const json = inputJsonSchema(schema);
  const type = Array.isArray(json.type) ? undefined : json.type;
  const base = type === 'object' ? z.record(z.string(), z.unknown()) : type === 'array' ? z.array(z.unknown()) : z.unknown();
  const summary = typeof json.description === 'string' ? `${json.description} ` : '';
  const described = base.describe(`${summary}Large shared schema omitted from discovery; the server validates the complete schema. Call get_tool_schema with {"tool":"${tool}","property":"${key}"} to read it.`);
  placeholders.set(inner, (placeholders.get(inner) ?? new Map()).set(id, described));
  return schema.isOptional() ? described.optional() : described;
}

export function compactToolInput(tool: string, inputSchema: unknown): CompactedTool | undefined {
  if (!isShape(inputSchema)) return undefined;
  const heavy = Object.entries(inputSchema).filter(([, schema]) => converted(schema).bytes > compactSchemaBytes).map(([key]) => key);
  if (!heavy.length) return { advertised: inputSchema, full: inputSchema, heavy };
  return { advertised: Object.fromEntries(Object.entries(inputSchema).map(([key, schema]) => [key, heavy.includes(key) ? placeholder(tool, key, schema) : schema])), full: inputSchema, heavy };
}

// Light arguments were already parsed by the SDK against identical schemas, so only the placeholders are
// parsed here; parsing light arguments again would repeat their transforms.
export function validateHeavyArguments(tool: string, compacted: CompactedTool, args: Record<string, unknown>): { args: Record<string, unknown> } | { error: ToolResult } {
  const parsed = z.object(Object.fromEntries(compacted.heavy.map(key => [key, compacted.full[key]]))).safeParse(Object.fromEntries(compacted.heavy.filter(key => key in args).map(key => [key, args[key]])));
  if (parsed.success) return { args: { ...args, ...parsed.data } };
  return { error: { isError: true, content: [{ type: 'text', text: `MCP error -32602: Input validation error: Invalid arguments for tool ${tool}: ${z.prettifyError(parsed.error)}` }] } };
}

const escapePointer = (token: string) => token.replace(/~/g, '~0').replace(/\//g, '~1');
function resolvePointer(root: unknown, input: string): unknown {
  // Accept the URI fragment form used by $ref ("#/$defs/Node") as well as a plain JSON Pointer.
  let pointer = input;
  if (pointer.startsWith('#')) {
    try { pointer = decodeURIComponent(pointer.slice(1)); } catch { return undefined; }
  }
  if (pointer === '') return root;
  if (!pointer.startsWith('/')) return undefined;
  let node = root;
  for (const token of pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (Array.isArray(node) && /^(0|[1-9]\d*)$/.test(token)) node = node[Number(token)];
    else if (isJson(node) && Object.hasOwn(node, token)) node = node[token];
    else return undefined;
  }
  return node;
}

// A large child schema becomes a stub that keeps what an agent needs to choose it (type, description,
// constant discriminators, required names) and the pointer that reads it in full.
function stub(schema: Json, pointer: string): Json {
  const constants = isJson(schema.properties)
    ? Object.fromEntries(Object.entries(schema.properties).filter(([, value]) => isJson(value) && 'const' in value).map(([key, value]) => [key, (value as Json).const]))
    : {};
  return {
    $pointer: pointer,
    ...(schema.type === undefined ? {} : { type: schema.type }),
    ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
    ...(Object.keys(constants).length ? { constants } : {}),
    ...(Array.isArray(schema.required) ? { required: schema.required } : {}),
    ...Object.fromEntries(['anyOf', 'oneOf', 'allOf'].filter(keyword => Array.isArray(schema[keyword])).map(keyword => [`${keyword}Count`, (schema[keyword] as unknown[]).length])),
  };
}
const schemaMaps = ['properties', '$defs', 'definitions', 'patternProperties'];
const schemaLists = ['anyOf', 'oneOf', 'allOf', 'prefixItems'];
function outline(schema: Json, pointer: string, childBytes: number): Json {
  const shrink = (value: unknown, at: string) => isJson(value) && JSON.stringify(value).length > childBytes ? stub(value, at) : value;
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => {
    const at = `${pointer}/${escapePointer(key)}`;
    if (schemaMaps.includes(key) && isJson(value)) return [key, Object.fromEntries(Object.entries(value).map(([name, child]) => [name, shrink(child, `${at}/${escapePointer(name)}`)]))];
    if (schemaLists.includes(key) && Array.isArray(value)) return [key, value.map((child, index) => shrink(child, `${at}/${index}`))];
    return [key, shrink(value, at)];
  }));
}

// Tool input shapes are rebuilt per request but are fixed per tool name, so whole-tool schemas are cached by name.
const wholeInputs = new Map<string, Json>();
function wholeInput(tool: string, entry: CompactedTool) {
  let schema = wholeInputs.get(tool);
  if (!schema) wholeInputs.set(tool, schema = inputJsonSchema(z.object(entry.full)));
  return schema;
}

export function toolSchemaDocument(tools: ReadonlyMap<string, CompactedTool>, tool: string, property?: string, pointer = '') {
  const entry = tools.get(tool);
  if (!entry) return { error: `Unknown tool ${tool}.`, tools: [...tools.keys()].sort() };
  const schema = property === undefined || !Object.hasOwn(entry.full, property) ? undefined : entry.full[property];
  if (property !== undefined && !schema) return { error: `Tool ${tool} has no argument ${property}.`, properties: Object.keys(entry.full) };
  const root = schema ? inputJsonSchema(schema) : wholeInput(tool, entry);
  const node = resolvePointer(root, pointer);
  if (!isJson(node)) return { error: `Pointer ${JSON.stringify(pointer)} does not name a schema in ${tool}${property === undefined ? '' : `.${property}`}.` };
  const identity = { tool, ...(property === undefined ? { compactedProperties: entry.heavy } : { property }), ...(pointer ? { pointer } : {}) };
  if (JSON.stringify(node).length <= schemaResponseBytes) return { ...identity, schema: node };
  // Stubbing every child bounds the answer when many small children still add up past the budget.
  const outlined = outline(node, pointer, outlineChildBytes);
  const compact = JSON.stringify(outlined).length <= schemaResponseBytes ? outlined : outline(node, pointer, 0);
  return {
    ...identity,
    outlined: true,
    note: 'This schema is too large for one response. Subschemas with a $pointer are summarized; call get_tool_schema again with the same tool and property and that pointer to read one.',
    schema: compact,
  };
}
