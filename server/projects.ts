import { sceneRequestSchema } from '../src/shared/scene-authoring-schema';
import { mutateDocument } from '../src/shared/operations';
import { inspectScene, inspectSceneAnimation } from '../src/shared/scene-inspection';
import { executePaintingCommand } from './painting-commands';
import { inspectElementImage } from '../src/shared/creative-elements-image-bounds';
import { inspectGif } from '../src/shared/gif-bounds';
import { documentSaveSchema } from '../src/shared/document-save-contract';
import { creativeSaveIdentity, readCreativeReceipt } from './creative-save-receipts';
import { reserveAsset } from './asset-lifecycle';
import { publicCreativeProjection } from '../src/shared/public-creative-projection';
import { preparePaintingAssets } from './painting-assets';
import { ownedDocumentAssetIds, remapDocumentAssets } from '../src/shared/document-asset-references';
import {documentWriteSchema} from '../src/shared/document-write';
import {characterEvolutionErrors} from '../src/shared/character-validation';
import { inspectMotion, motionInspectionSchema } from '../src/shared/motion-inspection';
import { updateEvent } from './observability-store';
import { Hono } from "hono";
import { z } from "zod";
import { documentSchema, type DesignDocument } from "../src/shared/schema";
import { createDocument } from "../src/shared/catalog";
import { renderHtml } from "../src/shared/render";
import type { Env } from "./types";
import { fail, id, now, origin, owner, secret } from "./security";
import { interactiveHtml } from './published-html';
import type { Context } from "hono";
export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  kind: DesignDocument["kind"];
  document: string;
  revision: number;
  created_at: string;
  updated_at: string;
  published_slug: string | null;
  thumbnail_revision?: number | null;
  thumbnail_deleting?: number;
}
export async function projectRow(c: Context<Env>, projectId: string) {
  const row = await c.env.DB.prepare(
    "SELECT projects.*, (SELECT MAX(revision) FROM project_thumbnails WHERE project_id=projects.id AND state='ready') AS thumbnail_revision FROM projects WHERE id=? AND user_id=?",
  )
    .bind(projectId, owner(c))
    .first<ProjectRow>();
  if (!row) fail(404, "not_found", "Project not found.");
  const span = c.get('telemetrySpan');
  if (span && span.event.projectId !== row!.id) { span.event.projectId = row!.id; await updateEvent(c.env, span.event); }
  return row!;
}
export const serializeProject = (row: ProjectRow, base: string) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  kind: row.kind,
  document: JSON.parse(row.document) as DesignDocument,
  revision: row.revision,
  thumbnailUrl: `/api/projects/${row.id}/thumbnail?revision=${row.revision}`,
  thumbnailRevision: row.thumbnail_revision ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.published_slug
    ? { publishedUrl: `${base}/published/${row.published_slug}` }
    : {}),
});
export async function validateAssets(c: Context<Env>, doc: DesignDocument, projectId?: string) {
  const refs = ownedDocumentAssetIds(doc);
  const references = [...refs];
  // D1 limits bound parameters per statement; chunks avoid one query per asset.
  for (let offset = 0; offset < references.length; offset += 90) {
    const chunk = references.slice(offset, offset + 90);
    const found = await c.env.DB.prepare(
      `SELECT id FROM assets WHERE user_id=? ${projectId ? 'AND project_id=?' : ''} AND id IN (${chunk.map(() => "?").join(",")})`,
    )
      .bind(owner(c), ...(projectId ? [projectId] : []), ...chunk)
      .all<{ id: string }>();
    if (found.results.length !== chunk.length)
      fail(400, "invalid_asset", "Document contains an unavailable asset. Import media into this project before referencing it.");
  }
  return refs;
}
export async function saveDocument(
  c: Context<Env>,
  projectId: string,
  document: unknown,
  expectedRevision: number,
  expectedBriefRevision?: number,
  operationId?: string,
  receiptIdentity?: { key: string; hash: string },
) {
  const row = await projectRow(c, projectId);
  // Diagnose a stale v1 client before validating fields that only exist in v2.
  if (document && typeof document === 'object' && 'schemaVersion' in document && document.schemaVersion === 1 && JSON.parse(row.document).schemaVersion === 2) {
    if (expectedRevision !== row.revision) fail(409, 'revision_conflict', 'Project changed. Reload before saving.');
    fail(409, 'document_upgrade_required', 'This project uses document v2. Upgrade your client and reload before saving.');
  }
  let parsed = documentSchema.parse(document);
  const identity = receiptIdentity ?? await creativeSaveIdentity(parsed, expectedRevision, operationId, expectedBriefRevision);
  if (identity) { const receipt = await readCreativeReceipt(c, row.id, identity); if (receipt) return receipt; }
  if (expectedRevision !== row.revision) fail(409, "revision_conflict", "Project changed. Reload before saving.");
  const stored = documentSchema.parse(JSON.parse(row.document));
  if (stored.schemaVersion === 2 && parsed.schemaVersion !== 2) fail(409, "document_upgrade_required", "This project uses document v2. Upgrade your client and reload before saving.");
  if (parsed.id !== row.id || parsed.kind !== row.kind)
    fail(
      400,
      "invalid_document",
      "Document ID and kind must match the project.",
    );
  const evolution=characterEvolutionErrors(JSON.parse(row.document).characters??[],parsed.characters??[]);if(evolution.length)fail(400,'invalid_topology',evolution.join('; '));
  await validateAssets(c, parsed, row.id);
  await preparePaintingAssets(c, row.id, parsed, stored);
  parsed.metadata.updatedAt = now();
  // Server-generated or restored asset references must obey the same canonical limits.
  parsed = documentSchema.parse(parsed);
  const statement = c.env.DB.prepare(
    "UPDATE projects SET document=?,name=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=? AND (? IS NULL OR COALESCE((SELECT revision FROM design_briefs WHERE project_id=projects.id AND user_id=projects.user_id),0)=?)",
  )
    .bind(
      JSON.stringify(parsed),
      parsed.name,
      parsed.metadata.updatedAt,
      row.id,
      owner(c),
      row.revision,
      expectedBriefRevision ?? null, expectedBriefRevision ?? null,
    );
  const committed = serializeProject({ ...row, document: JSON.stringify(parsed), name: parsed.name, revision: row.revision + 1, updated_at: parsed.metadata.updatedAt }, origin(c));
  const results = await c.env.DB.batch([statement, ...(identity ? [
    c.env.DB.prepare("INSERT INTO creative_save_receipts(operation_id,project_id,user_id,payload_hash,revision,response,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1").bind(identity.key, row.id, owner(c), identity.hash, committed.revision, JSON.stringify(committed), Date.now()),
    c.env.DB.prepare("DELETE FROM creative_save_receipts WHERE project_id=? AND user_id=? AND operation_id NOT LIKE 'job-%' AND operation_id NOT IN (SELECT operation_id FROM creative_save_receipts WHERE project_id=? AND user_id=? ORDER BY revision DESC LIMIT 8)").bind(row.id, owner(c), row.id, owner(c)),
  ] : [])]);
  const result = results[0] as { meta?: { changes?: number } };
  if (!result.meta?.changes && identity){const receipt=await readCreativeReceipt(c,row.id,identity);if(receipt)return receipt;}
  if (!result.meta?.changes)
    fail(409, "revision_conflict", "Project changed. Reload before saving.");
  return committed;
}
export async function storeAsset(
  c: Context<Env>,
  projectId: string,
  name: string,
  mimeType: string,
  data: ArrayBuffer,
) {
  await projectRow(c, projectId);
  if (data.byteLength > 20 * 1024 * 1024)
    fail(413, "asset_too_large", "Assets must be at most 20 MB.");
  const allowed = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "audio/mpeg",
    "audio/wav",
    "audio/ogg",
    "video/mp4",
    "video/webm",
    "model/gltf-binary",
  ];
  if (!allowed.includes(mimeType))
    fail(
      400,
      "unsupported_media",
      "Use PNG, JPEG, WebP, GIF, MP3, WAV, OGG, MP4, WebM, or GLB.",
    );
  const bytes = new Uint8Array(data);
  const ascii = (start: number, count: number) =>
    String.fromCharCode(...bytes.slice(start, start + count));
  const signatures: Record<string, boolean> = {
    "image/png":
      bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v),
    "image/jpeg": bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    "image/gif": ["GIF87a", "GIF89a"].includes(ascii(0, 6)),
    "image/webp": ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP",
    "audio/mpeg":
      ascii(0, 3) === "ID3" || (bytes[0] === 255 && (bytes[1] & 224) === 224),
    "audio/wav": ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE",
    "audio/ogg": ascii(0, 4) === "OggS",
    "video/mp4": ascii(4, 4) === "ftyp",
    "video/webm":
      bytes[0] === 26 &&
      bytes[1] === 69 &&
      bytes[2] === 223 &&
      bytes[3] === 163,
    "model/gltf-binary": ascii(0, 4) === "glTF",
  };
  if (!signatures[mimeType])
    fail(
      400,
      "invalid_media",
      "File bytes do not match the selected media type.",
    );
  if (['image/png','image/jpeg','image/webp'].includes(mimeType)) { try { inspectElementImage(bytes, mimeType); } catch (e) { fail(400, 'invalid_media', e instanceof Error ? e.message : 'Invalid image'); } }
  if (mimeType === 'image/gif') { try { inspectGif(bytes); } catch (e) { fail(400, 'invalid_media', e instanceof Error ? e.message : 'Invalid GIF'); } }
  const assetId = id();
  const storageKey = `${owner(c)}/${projectId}/${assetId}`;
  const reservation = await reserveAsset(c, projectId, data.byteLength);
  try {
    await c.env.ASSETS_BUCKET.put(storageKey, data, { httpMetadata: { contentType: mimeType } });
    const inserted = await c.env.DB.prepare(
      "INSERT INTO assets(id,user_id,project_id,name,mime_type,size,storage_key,created_at) SELECT ?,?,?,?,?,?,?,? FROM asset_reservations WHERE id=? AND expires_at>=?",
    )
      .bind(
        assetId,
        owner(c),
        projectId,
        name,
        mimeType,
        data.byteLength,
        storageKey,
        now(),
        reservation, Date.now(),
      )
      .run();
    if (!inserted.meta.changes) fail(408, "asset_upload_expired", "Upload expired before its asset was committed. Retry the upload.");
  } catch (error) {
    await c.env.ASSETS_BUCKET.delete(storageKey);
    throw error;
  } finally { await c.env.DB.prepare("DELETE FROM asset_reservations WHERE id=?").bind(reservation).run(); }
  return {
    id: assetId,
    name,
    type: mimeType.split("/")[0],
    mimeType,
    url: `/api/assets/${assetId}`,
    size: data.byteLength,
  };
}
export const projectRoutes = new Hono<Env>();
projectRoutes.get("/:id/assets", async (c) => {
  await projectRow(c, c.req.param("id"));
  const rows = await c.env.DB.prepare(
    "SELECT id,name,mime_type as mimeType,size FROM assets WHERE project_id=? AND user_id=? ORDER BY created_at DESC",
  )
    .bind(c.req.param("id"), owner(c))
    .all<{ id: string; name: string; mimeType: string; size: number }>();
  return c.json({
    assets: rows.results.map((a) => ({
      ...a,
      type: a.mimeType.split("/")[0],
      url: `/api/assets/${a.id}`,
    })),
  });
});
projectRoutes.get("/", async (c) => {
  const userId = owner(c);
  const q = c.req.query("q") ?? "";
  const kind = c.req.query("kind");
  const sort =
    {
      updated: "updated_at DESC",
      created: "created_at DESC",
      name: "name COLLATE NOCASE ASC",
    }[c.req.query("sort") ?? "updated"] ?? "updated_at DESC";
  const rows = await c.env.DB.prepare(
    `SELECT projects.*, (SELECT MAX(revision) FROM project_thumbnails WHERE project_id=projects.id AND state='ready') AS thumbnail_revision FROM projects WHERE user_id=? AND (name LIKE ? OR description LIKE ?) ${kind ? "AND kind=?" : ""} ORDER BY ${sort} LIMIT 500`,
  )
    .bind(userId, `%${q}%`, `%${q}%`, ...(kind ? [kind] : []))
    .all<ProjectRow>();
  return c.json({
    projects: rows.results.map((row) => {
      const { document, ...summary } = serializeProject(row, origin(c));
      return summary;
    }),
  });
});
projectRoutes.post("/", async (c) => {
  const body = z
    .object({
      name: z.string().trim().min(1).max(200),
      description: z.string().max(5000).default(""),
      kind: z
        .enum(["web", "slides", "report", "wireframe", "3d", "video"])
        .default("web"),
      document: documentSchema.optional(),
      themeId: z.string().max(120).optional(),
      templateId: z.string().max(120).optional(),
    })
    .parse(await c.req.json());
  const projectId = id();
  const doc = body.document ?? createDocument(body.kind, body.name, body.themeId, body.templateId);
  doc.id = projectId;
  doc.name = body.name;
  doc.kind = body.kind;
  const parsed = documentSchema.parse(doc);
  const sourceRefs = await validateAssets(c, parsed);
  const time = now();
  await c.env.DB.prepare(
    "INSERT INTO projects(id,user_id,name,description,kind,document,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)",
  )
    .bind(
      projectId,
      owner(c),
      body.name,
      body.description,
      body.kind,
      JSON.stringify(parsed),
      time,
      time,
    )
    .run();
  try {
    const mapping = new Map<string, Awaited<ReturnType<typeof storeAsset>>>();
    for (const sourceId of sourceRefs) {
      const source = await c.env.DB.prepare('SELECT name,mime_type,storage_key FROM assets WHERE id=? AND user_id=?').bind(sourceId, owner(c)).first<{name:string;mime_type:string;storage_key:string}>();
      if (!source) fail(400, 'invalid_asset', 'A source asset is no longer available.');
      const bytes = await c.env.ASSETS_BUCKET.get(source.storage_key);
      if (!bytes) fail(400, 'invalid_asset', 'A source asset could not be copied.');
      mapping.set(sourceId, await storeAsset(c, projectId, source.name, source.mime_type, await bytes.arrayBuffer()));
    }
    if (mapping.size) remapDocumentAssets(parsed, mapping);
    await preparePaintingAssets(c, projectId, parsed);
    if (mapping.size || parsed.schemaVersion === 2) {
      await c.env.DB.prepare('UPDATE projects SET document=? WHERE id=? AND user_id=?').bind(JSON.stringify(documentSchema.parse(parsed)), projectId, owner(c)).run();
    }
  } catch (error) {
    const copied = await c.env.DB.prepare('SELECT storage_key FROM assets WHERE project_id=? AND user_id=?').bind(projectId, owner(c)).all<{storage_key:string}>();
    await c.env.DB.prepare('DELETE FROM projects WHERE id=? AND user_id=?').bind(projectId, owner(c)).run();
    for (const asset of copied.results) await c.env.ASSETS_BUCKET.delete(asset.storage_key);
    throw error;
  }
  return c.json(
    { project: serializeProject(await projectRow(c, projectId), origin(c)) },
    201,
  );
});
projectRoutes.get("/:id", async (c) =>
  c.json({
    project: serializeProject(
      await projectRow(c, c.req.param("id")),
      origin(c),
    ),
  }),
);
projectRoutes.patch("/:id", async (c) => {
  const row = await projectRow(c, c.req.param("id"));
  const body = z
    .object({
      name: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(5000).optional(),
    })
    .parse(await c.req.json());
  const doc = JSON.parse(row.document);
  doc.name = body.name ?? row.name;
  doc.metadata.updatedAt = now();
  const result = await c.env.DB.prepare(
    "UPDATE projects SET name=?,description=?,document=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?",
  )
    .bind(
      doc.name,
      body.description ?? row.description,
      JSON.stringify(doc),
      now(),
      row.id,
      owner(c),
      row.revision,
    )
    .run();
  if (!result.meta.changes)
    fail(409, "revision_conflict", "Project changed. Try again.");
  return c.json({
    project: serializeProject(await projectRow(c, row.id), origin(c)),
  });
});
projectRoutes.put("/:id/document", async (c) => {
  // The owned save service validates the canonical document after its version guard.
  const body = documentWriteSchema.extend({ document: z.unknown() }).parse(await c.req.json());
  return c.json({
    project: await saveDocument(
      c,
      c.req.param("id"),
      body.document,
      body.expectedRevision,
      body.expectedBriefRevision,
      body.operationId,
    ),
  });
});
projectRoutes.delete("/:id", async (c) => {
  const row = await projectRow(c, c.req.param("id"));
  // Close thumbnail publication before reading storage keys, so deletion cannot miss a late cover.
  await c.env.DB.prepare("UPDATE projects SET thumbnail_deleting=1 WHERE id=? AND user_id=?").bind(row.id, owner(c)).run();
  const assets = await c.env.DB.prepare(
    "SELECT storage_key FROM assets WHERE project_id=? AND user_id=? UNION ALL SELECT storage_key FROM project_thumbnails WHERE project_id=? AND storage_key IS NOT NULL UNION ALL SELECT input_key FROM operation_jobs WHERE project_id=? UNION ALL SELECT result_key FROM operation_jobs WHERE project_id=? AND result_key IS NOT NULL",
  )
    .bind(row.id, owner(c), row.id, row.id, row.id)
    .all<{ storage_key: string }>();
  await c.env.DB.prepare("DELETE FROM projects WHERE id=? AND user_id=?")
    .bind(row.id, owner(c))
    .run();
  for (const asset of assets.results)
    await c.env.ASSETS_BUCKET.delete(asset.storage_key);
  return c.json({ ok: true });
});
projectRoutes.post("/:id/assets", async (c) => {
  await projectRow(c, c.req.param("id"));
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File))
    fail(400, "invalid_file", "A file field is required.");
  return c.json(
    {
      asset: await storeAsset(
        c,
        c.req.param("id"),
        file.name.slice(0, 200),
        file.type,
        await file.arrayBuffer(),
      ),
    },
    201,
  );
});
async function createPublication(c: Context<Env>) {
  const projectId = c.req.param("id");
  if (!projectId) fail(400, "invalid_project", "Project ID is required.");
  const row = await projectRow(c, projectId);
  const doc = publicCreativeProjection(documentSchema.parse(JSON.parse(row.document)));
  const refs = await validateAssets(c, doc, row.id);
  const slug = id();
  const replace = (url: string) =>
    url.startsWith("/api/assets/")
      ? `/published/${slug}/assets/${url.split("/").pop()}`
      : url;
  doc.assets = doc.assets.map((a) => ({ ...a, url: replace(a.url) }));
  for (const page of doc.pages)
    for (const node of page.nodes) if (node.src) node.src = replace(node.src);
  const statements = [
    c.env.DB.prepare(
      "INSERT INTO publications(slug,project_id,user_id,document,revision,created_at) VALUES(?,?,?,?,?,?)",
    ).bind(slug, row.id, owner(c), JSON.stringify(doc), row.revision, now()),
    ...Array.from(refs, (asset) =>
      c.env.DB.prepare(
        "INSERT INTO publication_assets(slug,asset_id) VALUES(?,?)",
      ).bind(slug, asset),
    ),
    c.env.DB.prepare(
      "UPDATE projects SET published_slug=? WHERE id=? AND user_id=?",
    ).bind(slug, row.id, owner(c)),
  ];
  await c.env.DB.batch(statements);
  return c.json({
    url: `${origin(c)}/published/${slug}`,
    revision: row.revision,
  });
}
projectRoutes.post("/:id/publish", createPublication);
projectRoutes.post("/:id/preview", createPublication);
projectRoutes.post("/:id/share", createPublication);

async function removePublications(c: Context<Env>) {
  const projectId = c.req.param("id");
  if (!projectId) fail(400, "invalid_project", "Project ID is required.");
  const row = await projectRow(c, projectId);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM publications WHERE project_id=? AND user_id=?",
    ).bind(row.id, owner(c)),
    c.env.DB.prepare(
      "UPDATE projects SET published_slug=NULL WHERE id=? AND user_id=?",
    ).bind(row.id, owner(c)),
  ]);
  return c.json({ ok: true });
}
projectRoutes.delete("/:id/publish", removePublications);
projectRoutes.delete("/:id/preview", removePublications);
projectRoutes.delete("/:id/share", removePublications);
export async function serveAsset(
  c: Context<Env>,
  assetId: string,
  slug?: string,
) {
  const row = slug
    ? await c.env.DB.prepare(
        "SELECT a.* FROM assets a JOIN publication_assets p ON p.asset_id=a.id WHERE p.slug=? AND a.id=?",
      )
        .bind(slug, assetId)
        .first<{ storage_key: string; mime_type: string; name: string }>()
    : await c.env.DB.prepare("SELECT * FROM assets WHERE id=? AND user_id=?")
        .bind(assetId, owner(c))
        .first<{ storage_key: string; mime_type: string; name: string }>();
  if (!row) fail(404, "not_found", "Asset not found.");
  const object = await c.env.ASSETS_BUCKET.get(row.storage_key);
  if (!object) fail(404, "not_found", "Asset bytes unavailable.");
  return new Response(object.body, {
    headers: {
      "Content-Type": row.mime_type,
      "Cache-Control": slug ? "public,max-age=3600" : "private,no-store",
      ...(slug ? { "Access-Control-Allow-Origin": "*" } : {}),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${row.name.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
    },
  });
}
export async function published(c: Context<Env>, slug: string) {
  const row = await c.env.DB.prepare(
    "SELECT document FROM publications WHERE slug=?",
  )
    .bind(slug)
    .first<{ document: string }>();
  if (!row) fail(404, "not_found", "Publication not found.");
  const nonce = secret();
  const document = documentSchema.parse(JSON.parse(row.document));
  // Speaker notes remain owner-only even for previously saved public snapshots.
  for (const page of document.pages) delete page.notes;
  return new Response(
    await interactiveHtml(c, document, nonce),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          `default-src 'none'; script-src 'nonce-${nonce}'; connect-src ${origin(c)} data: blob:; img-src 'self' https: data: blob:; media-src 'self' https: data: blob:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; sandbox allow-scripts; base-uri 'none'; form-action 'none'`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public,max-age=60",
      },
    },
  );
}

projectRoutes.get('/:id/motion',async c=>{const row=await projectRow(c,c.req.param('id'));const input=motionInspectionSchema.parse(c.req.query());const doc=documentSchema.parse(JSON.parse(row.document));if(input.nodeId&&!doc.pages.some(p=>p.nodes.some(n=>n.id===input.nodeId&&n.character)))fail(404,'not_found','Unknown character instance');if(input.characterId&&!doc.characters?.some(x=>x.id===input.characterId))fail(404,'not_found','Unknown character');return c.json({revision:row.revision,...inspectMotion(documentSchema.parse(JSON.parse(row.document)),input)});});

projectRoutes.get('/:id/scene', async c => {
  const row=await projectRow(c,c.req.param('id')); const query=z.object({pageId:z.string().optional(),time:z.coerce.number().finite().min(0).max(3600).default(0)}).parse(c.req.query());
  const doc=documentSchema.parse(JSON.parse(row.document));if(query.pageId&&!doc.pages.some(p=>p.id===query.pageId))fail(404,'not_found','Unknown page');
  return c.json({revision:row.revision,...inspectScene(doc,query.pageId,query.time)});
});
projectRoutes.post('/:id/scene', async c => {
  const row=await projectRow(c,c.req.param('id')),input=sceneRequestSchema.parse(await c.req.json());
  if(row.revision!==input.expectedRevision)fail(409,'conflict','Project revision changed. Read and reconcile before applying geometry.');
  let next:DesignDocument;try{next=mutateDocument(documentSchema.parse(JSON.parse(row.document)),[{op:'scene-command',pageId:input.pageId,command:input.command}]);}catch(error){if(error instanceof z.ZodError)throw error;fail(400,'invalid_scene_command',error instanceof Error?error.message:'Scene command failed');throw error;}
  const revision=input.preview?row.revision:(await saveDocument(c,row.id,next,input.expectedRevision)).revision;
  return c.json({revision,preview:input.preview,...inspectScene(next,input.pageId)});
});
projectRoutes.post('/:id/paint', async c => c.json({ project: await executePaintingCommand(c, c.req.param('id'), await c.req.json()) }));

projectRoutes.get('/:id/scene/animation',async c=>{
 const row=await projectRow(c,c.req.param('id')),doc=documentSchema.parse(JSON.parse(row.document));
 const query=z.object({pageId:z.string().min(1),start:z.coerce.number().min(0).max(3600).default(0),end:z.coerce.number().min(0).max(3600).optional(),samples:z.coerce.number().int().min(2).max(61).default(25)}).parse(c.req.query());
 if(!doc.pages.some(p=>p.id===query.pageId))fail(400,'invalid_page','Unknown page');
 if((query.end??doc.timeline?.duration??0)<query.start)fail(400,'invalid_range','End must follow start');
 return c.json({revision:row.revision,...inspectSceneAnimation(doc,query.pageId,query.start,query.end,query.samples)});
});
