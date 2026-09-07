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
import { renderHtml, renderSvg } from "../src/shared/render";
import { fail, origin, owner, unb64 } from "./security";
import { projectRow, saveDocument, storeAsset } from "./projects";
import { mediaInputSchema } from './providers';
export async function handleMcp(c: Context<Env>, app: Hono<Env>) {
  if (c.req.header("Origin") && c.req.header("Origin") !== origin(c))
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
  const protocol = c.req.header("MCP-Protocol-Version");
  if (
    protocol &&
    !["2025-11-25", "2025-06-18", "2025-03-26"].includes(protocol)
  )
    fail(
      400,
      "unsupported_protocol",
      "Supported MCP protocol: 2025-11-25 and SDK legacy compatibility.",
    );
  const server = new McpServer(
    { name: "design-studio-ai", version: "0.1.0" },
    {
      instructions:
        "An agent-first design workspace. All tools act as the authenticated owner. Get the current project revision before changing a document. AI generation produces a draft which must be saved explicitly. Publishing makes an immutable snapshot public.",
    },
  );
  const result = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  });
  const callApi = async (method: string, path: string, body?: unknown) => {
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
      c.env,
    );
    const value = await response.json();
    if (!response.ok) return { isError: true, ...result(value) };
    return result(value);
  };
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
        "Create a persisted project with an optional complete DesignDocument.",
      inputSchema: {
        name: z.string(),
        kind: z.enum(kinds).default("web"),
        description: z.string().optional(),
        document: documentSchema.optional(),
        themeId: z.string().optional(),
        templateId: z.string().optional(),
      },
    },
    async (body) => callApi("POST", "/api/projects", body),
  );
  server.registerTool(
    "update_document",
    {
      description:
        "Persist a complete validated document. expectedRevision is required; stale revisions fail with conflict.",
      inputSchema: {
        projectId: z.string(),
        document: documentSchema,
        expectedRevision: z.number().int().positive(),
      },
    },
    async ({ projectId, ...body }) =>
      callApi(
        "PUT",
        `/api/projects/${encodeURIComponent(projectId)}/document`,
        body,
      ),
  );
  server.registerTool(
    "patch_document",
    {
      description:
        "Apply shared document operations atomically. Inspect schema resource for operation contracts. Requires expectedRevision.",
      inputSchema: {
        projectId: z.string(),
        operations: operationsSchema,
        expectedRevision: z.number().int().positive(),
      },
    },
    async ({ projectId, operations, expectedRevision }) => {
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
    "export_project",
    {
      description:
        "Render the saved design on the cloud and return actual file bytes. PNG is a visual preview. PPTX preserves editable text/shapes. Video supports up to 60 seconds. Import external media into the project first.",
      inputSchema: {
        projectId: z.string(),
        format: z.enum(["json", "html", "svg", "png", "pdf", "pptx", "webm", "mp4"]),
        pageIndex: z.number().int().min(0).default(0),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, format, pageIndex }) => {
      const response = await app.request(`${origin(c)}/api/projects/${encodeURIComponent(projectId)}/export`, { method: 'POST', headers: { Authorization: c.req.header('Authorization')!, 'Content-Type': 'application/json' }, body: JSON.stringify({ format, pageIndex }) }, c.env);
      if (!response.ok) return { isError: true, ...result(await response.json()) };
      if (['json', 'html', 'svg'].includes(format)) return result({ format, content: await response.text() });
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 20 * 1024 * 1024) return { isError: true, ...result({ error: { message: 'This export exceeds the MCP response limit. Download it with the CLI export command.' } }) };
      const data = Buffer.from(bytes).toString('base64');
      if (format === 'png') return { content: [{ type: 'image' as const, mimeType: 'image/png', data }] };
      return { content: [{ type: 'resource' as const, resource: { uri: `studio://exports/${projectId}/${pageIndex}.${format}`, mimeType: response.headers.get('Content-Type')!, blob: data } }] };
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
        provider: z.enum(["openai", "anthropic", "gemini", "openrouter"]),
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
    'operation-schema', 'studio://operations', { description: 'Atomic design operation JSON schema' },
    async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(z.toJSONSchema(operationsSchema)) }] })
  );
  server.registerResource(
    "document-schema",
    "studio://schema",
    { description: "DesignDocument v1 JSON schema" },
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
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    await server.close();
  }
}
