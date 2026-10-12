import { registerConnectorAgentTools } from './connector-agent-tools';
import { limitedBytes } from './providers';
import { AsyncLocalStorage } from "node:async_hooks";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Context, Hono } from "hono";
import type { Env } from "./types";
import { documentSchema, kinds } from "../src/shared/schema";
import { themes, templates, blocks } from "../src/shared/catalog";
import { mutateDocument, operationsSchema } from "../src/shared/operations";
import { parseYamlInput, yamlInputMaxBytes } from '../src/shared/yaml-input';
import { renderHtml, renderSvg } from "../src/shared/render";
import { fail, origin, owner, unb64 } from "./security";
import { projectRow, saveDocument, storeAsset } from "./projects";
import { mediaInputSchema, textProviderSchema } from './providers';
import { interviewSchema, answerSchema, scopeSchema } from '../src/shared/brief';
import { mergeRequestSchema } from '../src/shared/collaboration-contract';
import { withSpan, telemetryEnv, type TelemetrySpan } from './observability';
import { registerObservabilityTools } from './observability-tools';
import { registerDesignSystemTools } from './design-system-tools';
import { compactToolInput, toolSchemaDocument, validateHeavyArguments, type CompactedTool } from './mcp-tool-schemas';
import { completeModernResponse, dispatchMcpRequest, jsonRpcError, supportedProtocolVersions, type McpRequestInfo, type McpServerDescription } from './mcp-protocol';
// Hosted connectors send their own Origin; these are accepted alongside the app and TRUSTED_ORIGINS.
// Bearer credentials, not cookies, authorize MCP, so a browser origin cannot borrow a signed-in session.
const hostedConnectorOrigins = ['https://chatgpt.com', 'https://chat.openai.com'];
const loggedMethods = new Set(['initialize', 'notifications/initialized', 'ping', 'server/discover', 'tools/list', 'tools/call', 'resources/list', 'resources/templates/list', 'resources/read', 'prompts/list', 'prompts/get', 'subscriptions/listen']);
const serverDescription: McpServerDescription = {
  serverInfo: { name: "design-studio-ai", version: "0.3.1" },
  instructions:
    "An agent-first design workspace. All tools act as the authenticated owner. Get the current project revision before changing a document. AI generation produces a draft which must be saved explicitly. Publishing makes an immutable snapshot public. Large document arguments are summarized in tool discovery; call get_tool_schema for their complete JSON Schema.",
  capabilities: { tools: {}, resources: {} },
};
export async function handleMcp(c: Context<Env>, app: Hono<Env>) {
  const started = Date.now();
  const requestOrigin = c.req.header("Origin");
  const trustedOrigins = [origin(c), ...hostedConnectorOrigins, ...(c.env.TRUSTED_ORIGINS ?? "").split(",").filter(Boolean)];
  if (requestOrigin && !trustedOrigins.includes(requestOrigin))
    fail(403, "invalid_origin", "MCP origin is not allowed.");
  if (!c.get("user") || c.get("authMethod") !== "token") {
    c.header(
      "WWW-Authenticate",
      `Bearer resource_metadata="${origin(c)}/.well-known/oauth-protected-resource"`,
    );
    return c.json(
      {
        error: {
          code: "unauthorized",
          message: "Use a Design Studio API key or OAuth access token.",
        },
      },
      401,
    );
  }
  if (c.req.method !== "POST")
    return c.json(
      {
        error: {
          code: "method_not_allowed",
          message: "Use stateless Streamable HTTP POST.",
        },
      },
      405,
    );
  const dispatch = await dispatchMcpRequest(c.req.raw, serverDescription);
  if ('response' in dispatch) return finishMcpRequest(c, dispatch.info, dispatch.response, started);
  const server = new McpServer(serverDescription.serverInfo, { instructions: serverDescription.instructions });
  // All tool outcomes share the request trace, including direct service operations.
  const toolSpan = new AsyncLocalStorage<TelemetrySpan>();
  const register = server.registerTool.bind(server);
  const toolInputs = new Map<string, CompactedTool>();
  server.registerTool = ((name: string, config: { inputSchema?: unknown }, handler: (...args: any[]) => any) => {
    const compacted = compactToolInput(name, config.inputSchema);
    if (compacted) toolInputs.set(name, compacted);
    return register(name, (compacted ? { ...config, inputSchema: compacted.advertised } : config) as any, async (...args: any[]) => withSpan(c, { kind: 'mcp', action: name }, async span => toolSpan.run(span, async () => {
        const checked = compacted?.heavy.length ? validateHeavyArguments(name, compacted, args[0] ?? {}) : undefined;
        const response = checked && 'error' in checked ? checked.error : await handler(...(checked ? [checked.args, ...args.slice(1)] : args));
        if (response?.isError) span.set({ status: 'error', errorCode: 'mcp_tool_error' });
        return response;
    })));
  }) as typeof server.registerTool;
  const result = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  });
  const callApi = async (method: string, path: string, body?: unknown, binary = false) => {
    const response = await app.request(
      `${origin(c)}${path}`,
      {
        method,
        headers: {
          Authorization: c.req.header("Authorization")!,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      telemetryEnv(c, toolSpan.getStore()),
    );
    if(binary&&response.ok){
      const bytes=await limitedBytes(response,20*1024*1024);
      return result({mimeType:response.headers.get("Content-Type"),encoding:"base64",data:Buffer.from(bytes).toString("base64"),bytes:bytes.byteLength,trust:"external source data"});
    }
    const value = await response.json();
    if (!response.ok) return { isError: true, ...result(value) };
    return result(value);
  };
  registerConnectorAgentTools(server, callApi);
  // YAML is only an authoring convenience: it is parsed to plain data and then validated by the same JSON schemas.
  const yamlField = (field: string) => z.string().max(yamlInputMaxBytes).optional().describe(`Alternative to ${field}: the same ${field} authored as one YAML 1.2 document (no tags, anchors or aliases). Parsed then validated by the identical JSON schema (see studio://schema and studio://operations); responses and storage stay JSON. Send ${field} or ${field}Yaml, not both.`);
  const authored = <T extends z.ZodType>(schema: T, field: string, json: unknown, yaml: string | undefined): { value?: z.output<T>; error?: ReturnType<typeof result> & { isError: true } } => {
    const fail = (message: string) => ({ error: { isError: true as const, ...result({ error: { code: 'invalid_input', message } }) } });
    if (yaml === undefined) return json === undefined ? { value: undefined } : { value: json as z.output<T> };
    if (json !== undefined) return fail(`Send either ${field} (JSON) or ${field}Yaml, not both.`);
    try {
      const parsed = schema.safeParse(parseYamlInput(yaml));
      return parsed.success ? { value: parsed.data } : fail(`${field}Yaml does not match the ${field} schema: ${parsed.error.issues.slice(0, 8).map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    } catch (error) { return fail(error instanceof Error ? error.message : `${field}Yaml could not be parsed.`); }
  };
  registerDesignSystemTools(server, callApi);
  registerObservabilityTools(server, callApi);
  server.registerTool(
    'merge_design',
    { description: 'Merge your edited document against the exact base read earlier. Independent changes are retained; same-field conflicts require reconciliation. Never change the base to bypass a conflict.', inputSchema: { projectId: z.string(), ...mergeRequestSchema.shape } },
    async ({ projectId, ...body }) => callApi('POST', `/api/projects/${encodeURIComponent(projectId)}/merge`, body),
  );
  server.registerTool(
    'get_design_changes',
    { description: 'Read changes since a known revision. Useful for observing human edits before applying new agent operations.', inputSchema: { projectId: z.string(), since: z.number().int().min(0).optional() }, annotations: { readOnlyHint: true } },
    async ({ projectId, since }) => callApi('GET', `/api/projects/${encodeURIComponent(projectId)}/changes?since=${since ?? 0}`),
  );
  server.registerTool(
    'inspect_design',
    {description:'Run read-only deterministic design preflight on the saved revision: text fitting, estimated contrast, page bounds, media, chart data and export limits. Returns exact node IDs and suggestions. These hints do not replace visual inspection or certify accessibility.', inputSchema:{projectId:z.string()}, annotations:{readOnlyHint:true}},
    async ({projectId}) => callApi('GET', `/api/projects/${encodeURIComponent(projectId)}/checks`),
  );
  server.registerTool(
    'get_design_brief',
    {description:'Read the persisted request, interactive questions, answers, scope, approval and brief revision. A null brief has not been started.', inputSchema:{projectId:z.string()}, annotations:{readOnlyHint:true}},
    async ({projectId}) => callApi('GET', `/api/projects/${encodeURIComponent(projectId)}/brief`),
  );
  server.registerTool(
    'update_design_brief',
    {description:'Start or update an interview using your own model without a server provider key. Supply contextual questions and a proposed scope; show questions to the human in your chat or the Studio UI. Every edit invalidates approval. expectedRevision is the brief revision (0 creates), independent from document revision.', inputSchema:{projectId:z.string(),expectedRevision:z.number().int().min(0),request:z.string().trim().min(1).max(12000).optional(),interview:interviewSchema.optional(),answers:answerSchema.optional(),scope:scopeSchema.optional()}},
    async ({projectId,...body}) => callApi('PUT', `/api/projects/${encodeURIComponent(projectId)}/brief`,body),
  );
  server.registerTool(
    'interview_design_brief',
    {description:'Ask the owner-configured BYOK provider to prepare contextual questions or a scope from saved answers. Incurs provider usage. Updates the brief only if its revision is unchanged.', inputSchema:{projectId:z.string(),expectedRevision:z.number().int().positive(),provider:textProviderSchema,model:z.string().min(1).max(200).optional()}},
    async ({projectId,...body}) => callApi('POST', `/api/projects/${encodeURIComponent(projectId)}/brief/interview`,body),
  );
  server.registerTool(
    'approve_design_brief',
    {description:'Lock the scope after the human explicitly approves the current objective, audience, direction, deliverables and acceptance criteria. Never infer approval from missing answers or silence. Requires all required answers and a complete scope. Does not generate or publish.', inputSchema:{projectId:z.string(),expectedRevision:z.number().int().positive()}},
    async ({projectId,...body}) => callApi('POST', `/api/projects/${encodeURIComponent(projectId)}/brief/approve`,body),
  );
  server.registerTool(
    "list_projects",
    {
      description: "List your projects. Read only.",
      inputSchema: {
        query: z.string().optional(),
        kind: z.enum(kinds).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, kind }) =>
      callApi(
        "GET",
        `/api/projects?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(kind ? { kind } : {}) })}`,
      ),
  );
  server.registerTool(
    "get_project",
    {
      description: "Read a complete project and its current revision.",
      inputSchema: { projectId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) =>
      callApi("GET", `/api/projects/${encodeURIComponent(projectId)}`),
  );
  server.registerTool(
    "create_project",
    {
      description:
        "Create a persisted project with an optional complete DesignDocument, sent as document (JSON) or documentYaml (YAML string, same schema).",
      inputSchema: {
        name: z.string(),
        kind: z.enum(kinds).default("web"),
        description: z.string().optional(),
        document: documentSchema.optional(),
        documentYaml: yamlField('document'),
        themeId: z.string().optional(),
        templateId: z.string().optional(),
      },
    },
    async ({ documentYaml, ...body }) => {
      const input = authored(documentSchema, 'document', body.document, documentYaml);
      if (input.error) return input.error;
      return callApi("POST", "/api/projects", { ...body, document: input.value });
    },
  );
  server.registerTool(
    "update_document",
    {
      description:
        "Persist a complete validated document. expectedRevision is required; stale revisions fail with conflict. Send document (JSON) or documentYaml (YAML string, same schema).",
      inputSchema: {
        projectId: z.string(),
        document: documentSchema.optional(),
        documentYaml: yamlField('document'),
        expectedRevision: z.number().int().positive(),
      },
    },
    async ({ projectId, documentYaml, ...body }) => {
      const input = authored(documentSchema, 'document', body.document, documentYaml);
      if (input.error) return input.error;
      if (input.value === undefined) return { isError: true, ...result({ error: { code: 'invalid_input', message: 'Send document (JSON) or documentYaml.' } }) };
      return callApi(
        "PUT",
        `/api/projects/${encodeURIComponent(projectId)}/document`,
        { ...body, document: input.value },
      );
    },
  );
  server.registerTool(
    "patch_document",
    {
      description:
        "Apply shared document operations atomically. Inspect schema resource for operation contracts. Requires expectedRevision. Send operations (JSON) or operationsYaml (YAML string, same schema).",
      inputSchema: {
        projectId: z.string(),
        operations: operationsSchema.optional(),
        operationsYaml: yamlField('operations'),
        expectedRevision: z.number().int().positive(),
      },
    },
    async ({ projectId, operations: jsonOperations, operationsYaml, expectedRevision }) => {
      const input = authored(operationsSchema, 'operations', jsonOperations, operationsYaml);
      if (input.error) return input.error;
      const operations = input.value;
      if (operations === undefined) return { isError: true, ...result({ error: { code: 'invalid_input', message: 'Send operations (JSON) or operationsYaml.' } }) };
      try {
        const row = await projectRow(c, projectId);
        const doc = mutateDocument(
          documentSchema.parse(JSON.parse(row.document)),
          operations as Parameters<typeof mutateDocument>[1],
        );
        return result({
          project: await saveDocument(c, projectId, doc, expectedRevision),
        });
      } catch (error) {
        return {
          isError: true,
          ...result({
            error: {
              message: error instanceof Error ? error.message : "Patch failed",
            },
          }),
        };
      }
    },
  );
  server.registerTool(
    "delete_project",
    {
      description:
        "Permanently delete a project, its assets, and publications.",
      inputSchema: { projectId: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ projectId }) =>
      callApi("DELETE", `/api/projects/${encodeURIComponent(projectId)}`),
  );
  server.registerTool(
    "list_themes",
    {
      description: "List built-in complete themes.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => result({ themes }),
  );
  server.registerTool(
    "list_templates",
    {
      description: "List templates for all supported design kinds.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => result({ templates }),
  );
  server.registerTool(
    "list_components",
    {
      description: "List reusable editable component node definitions.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => result({ components: blocks }),
  );
  server.registerTool(
    "apply_theme",
    {
      description:
        "Apply a complete built-in theme to a project. Requires expectedRevision.",
      inputSchema: {
        projectId: z.string(),
        themeId: z.string(),
        expectedRevision: z.number().int().positive(),
      },
    },
    async ({ projectId, themeId, expectedRevision }) => {
      const theme = themes.find((t) => t.id === themeId);
      if (!theme)
        return {
          isError: true,
          ...result({ error: { message: "Unknown theme" } }),
        };
      const row = await projectRow(c, projectId);
      const doc = documentSchema.parse(JSON.parse(row.document));
      doc.theme = theme;
      return result({
        project: await saveDocument(c, projectId, doc, expectedRevision),
      });
    },
  );
  server.registerTool(
    "upload_asset",
    {
      description:
        "Upload base64 binary media to a private project. Maximum 20MB. Returns a reference for document nodes.",
      inputSchema: {
        projectId: z.string(),
        name: z.string().max(200),
        mimeType: z.string(),
        base64: z.string().max(28 * 1024 * 1024),
      },
    },
    async ({ projectId, name, mimeType, base64 }) =>
      result({
        asset: await storeAsset(
          c,
          projectId,
          name,
          mimeType,
          unb64(base64).buffer as ArrayBuffer,
        ),
      }),
  );
  server.registerTool(
    "list_assets",
    {
      description: "List private assets owned by a project.",
      inputSchema: { projectId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) => {
      await projectRow(c, projectId);
      const rows = await c.env.DB.prepare(
        "SELECT id,name,mime_type as mimeType,size FROM assets WHERE project_id=? AND user_id=?",
      )
        .bind(projectId, owner(c))
        .all<{ id: string; name: string; mimeType: string; size: number }>();
      return result({
        assets: rows.results.map((a) => ({
          ...a,
          type: a.mimeType.split("/")[0],
          url: `/api/assets/${a.id}`,
        })),
      });
    },
  );
  server.registerTool(
    "publish_project",
    {
      description:
        "Publish an immutable public HTML snapshot and its referenced assets. Makes content public.",
      inputSchema: { projectId: z.string() },
      annotations: { destructiveHint: false },
    },
    async ({ projectId }) =>
      callApi("POST", `/api/projects/${encodeURIComponent(projectId)}/publish`),
  );
  server.registerTool(
    "preview_project",
    {
      description:
        "Create a public immutable preview snapshot and return its URL. Makes content public.",
      inputSchema: { projectId: z.string() },
      annotations: { destructiveHint: false },
    },
    async ({ projectId }) =>
      callApi("POST", `/api/projects/${encodeURIComponent(projectId)}/preview`),
  );
  server.registerTool(
    "share_project",
    {
      description:
        "Create a public immutable share snapshot and return its URL. Makes content public.",
      inputSchema: { projectId: z.string() },
      annotations: { destructiveHint: false },
    },
    async ({ projectId }) =>
      callApi("POST", `/api/projects/${encodeURIComponent(projectId)}/share`),
  );
  server.registerTool(
    "unpublish_project",
    {
      description: "Remove all public snapshots of a project.",
      inputSchema: { projectId: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ projectId }) =>
      callApi(
        "DELETE",
        `/api/projects/${encodeURIComponent(projectId)}/publish`,
      ),
  );
  server.registerTool(
    "unpreview_project",
    {
      description: "Remove all public snapshots of a project through the preview alias.",
      inputSchema: { projectId: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ projectId }) =>
      callApi(
        "DELETE",
        `/api/projects/${encodeURIComponent(projectId)}/preview`,
      ),
  );
  server.registerTool(
    "unshare_project",
    {
      description: "Remove all public snapshots of a project through the share alias.",
      inputSchema: { projectId: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ projectId }) =>
      callApi(
        "DELETE",
        `/api/projects/${encodeURIComponent(projectId)}/share`,
      ),
  );
  server.registerTool(
    "export_project",
    {
      description:
        "Render the saved design on the cloud and return actual file bytes. PNG is a visual preview. PPTX preserves legacy editable text/shapes and rasterizes structured layouts. React returns runnable frontend source ZIP; GLB/glTF return scene geometry and animation. Video supports up to 60 seconds. Import external media into the project first.",
      inputSchema: {
        projectId: z.string(),
        format: z.enum(["json", "html", "svg", "png", "pdf", "pptx", "webm", "mp4", "react", "glb", "gltf"]),
        pageIndex: z.number().int().min(0).default(0),
        expectedRevision: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, format, pageIndex, expectedRevision }) => {
      const response = await app.request(`${origin(c)}/api/projects/${encodeURIComponent(projectId)}/export`, { method: 'POST', headers: { Authorization: c.req.header('Authorization')!, 'Content-Type': 'application/json' }, body: JSON.stringify({ format, pageIndex, expectedRevision }) }, telemetryEnv(c, toolSpan.getStore()));
      if (!response.ok) return { isError: true, ...result(await response.json()) };
      if (['json', 'html', 'svg'].includes(format)) return result({ format, content: await response.text() });
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 20 * 1024 * 1024) return { isError: true, ...result({ error: { message: 'This export exceeds the MCP response limit. Download it with the CLI export command.' } }) };
      const data = Buffer.from(bytes).toString('base64');
      if (format === 'png') return { content: [{ type: 'image' as const, mimeType: 'image/png', data }] };
      return { content: [{ type: 'resource' as const, resource: { uri: `studio://exports/${projectId}/${pageIndex}.${format === 'react' ? 'zip' : format}`, mimeType: response.headers.get('Content-Type')!, blob: data } }] };
    },
  );
  server.registerTool(
    "generate_design",
    {
      description:
        "Ask a configured BYOK text provider to propose a complete design. Can incur provider charges. Does not save; use update_document after reviewing.",
      inputSchema: {
        projectId: z.string(),
        prompt: z.string().min(1).max(12000),
        provider: textProviderSchema,
        model: z.string().optional(),
        expectedRevision: z.number().int().positive(),
      },
    },
    async ({ projectId, ...body }) =>
      callApi(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/generate`,
        body,
      ),
  );
  server.registerTool(
    "generate_media",
    {
      description:
        "Generate or transform image, video, speech, music and effects via configured BYOK. Source assets must belong to this project. Can incur provider charges.",
      inputSchema: {
        projectId: z.string(),
        ...mediaInputSchema.shape,
      },
    },
    async ({ projectId, ...body }) =>
      callApi(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/media`,
        body,
      ),
  );
  server.registerTool(
    "get_media_job",
    {
      description:
        "Check a queued media generation job and save completed bytes as a private project asset.",
      inputSchema: { projectId: z.string(), jobId: z.string() },
    },
    async ({ projectId, jobId }) =>
      callApi(
        "GET",
        `/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(jobId)}`,
      ),
  );
  server.registerResource(
    'operation-schema', 'studio://operations', { description: 'Atomic design operation JSON schema. Send as operations, or as the same array authored in YAML via operationsYaml; both validate against this schema.' },
    async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(z.toJSONSchema(operationsSchema)) }] })
  );
  server.registerResource(
    "document-schema",
    "studio://schema",
    { description: "DesignDocument v1 JSON schema. Send as document, or the same structure authored in YAML via documentYaml; both validate against this schema." },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(z.toJSONSchema(documentSchema)),
        },
      ],
    }),
  );
  server.registerResource(
    "project-document",
    new ResourceTemplate("studio://projects/{projectId}", { list: undefined }),
    { description: "A private project document" },
    async (uri, { projectId }) => {
      const row = await projectRow(c, String(projectId));
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: row.document },
        ],
      };
    },
  );
  server.registerTool(
    "get_tool_schema",
    {
      description: "Read the complete input JSON Schema of a tool, or of one argument. Use it for arguments that discovery summarizes, such as documents and operation lists.",
      inputSchema: {
        tool: z.string().min(1).max(100),
        property: z.string().min(1).max(100).optional(),
        pointer: z.string().max(500).optional().describe('JSON Pointer inside the returned schema, from a $pointer in an outlined answer.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ tool, property, pointer }) => {
      const document = toolSchemaDocument(toolInputs, tool, property, pointer);
      return 'error' in document ? { isError: true, ...result(document) } : result(document);
    },
  );
  let response: Response;
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    response = await transport.handleRequest(dispatch.forward);
    if (dispatch.info.era === 'modern') response = await completeModernResponse(response, serverDescription);
  } catch (error) {
    response = jsonRpcError(500, dispatch.info.id, -32603, 'Internal error');
    console.warn('mcp_request_failed', { method: logMethod(dispatch.info.method), error: error instanceof Error ? error.name : 'unknown' });
  } finally {
    await server.close();
  }
  return finishMcpRequest(c, dispatch.info, response, started);
}

const logMethod = (method: string | null) => method === null || loggedMethods.has(method) ? method : 'other';
async function finishMcpRequest(c: Context<Env>, info: McpRequestInfo, response: Response, started: number) {
  const bytes = Number(response.headers.get('Content-Length')) || (response.body ? (await response.clone().arrayBuffer()).byteLength : 0);
  c.get('telemetrySpan')?.set({ outputBytes: bytes });
  // Diagnostic metadata only: never credentials, arguments or results. Client strings are bounded.
  const protocolVersion = info.protocolVersion === null || supportedProtocolVersions.includes(info.protocolVersion) ? info.protocolVersion : 'unsupported';
  console.info('mcp_request', JSON.stringify({ requestId: c.get('telemetrySpan')?.event.traceId ?? null, method: logMethod(info.method), era: info.era, protocolVersion, status: response.status, durationMs: Date.now() - started, responseBytes: bytes }));
  return response;
}
