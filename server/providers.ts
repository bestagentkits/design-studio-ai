import { Hono } from "hono";
import { z } from "zod";
import type { Context } from "hono";
import type { Env } from "./types";
import { decrypt, encrypt, fail, id, now, owner, unb64, rateLimit } from "./security";
import { projectRow, storeAsset, validateAssets } from "./projects";
import { documentSchema } from "../src/shared/schema";
const defaults: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1" },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4.1",
  },
  fal: {
    baseUrl: "https://queue.fal.run",
    model: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
  },
};
interface Provider {
  provider: string;
  encrypted_key: string;
  base_url: string;
  model: string;
}
function allowedBase(c: Context<Env>, provider: string, base: string) {
  const config = defaults[provider];
  if (!config) fail(400, "unsupported_provider", "Unknown provider.");
  const url = new URL(base);
  const allowed = [
    new URL(config.baseUrl).origin,
    ...(c.env.PROVIDER_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean),
  ];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !allowed.includes(url.origin)
  )
    fail(
      400,
      "invalid_provider_url",
      "Provider base URL must use an operator-allowlisted HTTPS origin.",
    );
  return base.replace(/\/+$/, "");
}
export async function providerConfig(c: Context<Env>, provider: string) {
  const row = await c.env.DB.prepare(
    "SELECT * FROM providers WHERE user_id=? AND provider=?",
  )
    .bind(owner(c), provider)
    .first<Provider>();
  if (!row)
    fail(
      400,
      "provider_unconfigured",
      "Add your provider API key in Settings first.",
    );
  allowedBase(c, provider, row.base_url);
  return { ...row, key: await decrypt(c.env, row.encrypted_key) };
}
export async function limitedBytes(
  response: Response,
  limit = 24 * 1024 * 1024,
) {
  const reader = response.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > limit) {
      await reader.cancel();
      fail(
        502,
        "provider_response_too_large",
        "Provider response exceeded the size limit.",
      );
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}
export async function upstream(
  url: string,
  init: RequestInit,
  timeout = 120000,
) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    return fail(
      502,
      "provider_unavailable",
      "Provider request failed or timed out. Check your endpoint and try again.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    fail(
      502,
      "provider_error",
      `Provider returned HTTP ${response.status}. Check credentials, model access, and quota.`,
    );
  }
  return response;
}
async function jsonResponse(response: Response) {
  try {
    return JSON.parse(new TextDecoder().decode(await limitedBytes(response)));
  } catch (error) {
    if (error instanceof SyntaxError)
      fail(502, "invalid_provider_response", "Provider returned invalid JSON.");
    throw error;
  }
}
export const providerRoutes = new Hono<Env>();
providerRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT provider,base_url,model FROM providers WHERE user_id=?",
  )
    .bind(owner(c))
    .all<Provider>();
  return c.json({
    providers: rows.results.map((row) => ({
      provider: row.provider,
      baseUrl: row.base_url,
      model: row.model,
      configured: true,
      apiKey: "••••••••",
    })),
  });
});
providerRoutes.put("/:provider", async (c) => {
  const provider = c.req.param("provider");
  const body = z
    .object({
      apiKey: z.string().min(8).max(4096),
      baseUrl: z.string().url().optional(),
      model: z.string().min(1).max(200).optional(),
    })
    .parse(await c.req.json());
  if (!defaults[provider])
    fail(400, "unsupported_provider", "Unknown provider.");
  const baseUrl = allowedBase(
    c,
    provider,
    body.baseUrl ?? defaults[provider].baseUrl,
  );
  const model = body.model ?? defaults[provider].model;
  await c.env.DB.prepare(
    "INSERT INTO providers(user_id,provider,encrypted_key,base_url,model) VALUES(?,?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET encrypted_key=excluded.encrypted_key,base_url=excluded.base_url,model=excluded.model",
  )
    .bind(owner(c), provider, await encrypt(c.env, body.apiKey), baseUrl, model)
    .run();
  return c.json({
    provider,
    baseUrl,
    model,
    configured: true,
    apiKey: "••••••••",
  });
});
providerRoutes.delete("/:provider", async (c) => {
  await c.env.DB.prepare("DELETE FROM providers WHERE user_id=? AND provider=?")
    .bind(owner(c), c.req.param("provider"))
    .run();
  return c.json({ ok: true });
});
export const generationRoutes = new Hono<Env>();
generationRoutes.post("/:id/generate", async (c) => {
  const row = await projectRow(c, c.req.param("id"));
  const body = z
    .object({
      prompt: z.string().trim().min(1).max(12000),
      provider: z.enum(["openai", "anthropic", "gemini", "openrouter"]),
      model: z.string().min(1).max(200).optional(),
      expectedRevision: z.number().int().positive(),
    })
    .parse(await c.req.json());
  if (body.expectedRevision !== row.revision)
    fail(409, "revision_conflict", "Reload the project before generating.");
  const config = await providerConfig(c, body.provider);
  const model = body.model ?? config.model;
  const system =
    "You edit DesignDocument v1 JSON. Return only the complete valid document, no prose or markdown. Preserve id and kind and existing useful content unless asked. Nodes have finite pixel x,y,width,height; type frame,text,image,shape,icon,chart,model3d,video,audio. Text belongs in text, styles in style. Never return executable code, scripts, event handlers, or javascript URLs. Parent IDs must exist on the same page. Preserve schemaVersion, theme, pages, assets and metadata. Current document: " +
    row.document;
  let result: any;
  let output: string = "";
  if (body.provider === "anthropic") {
    result = await jsonResponse(
      await upstream(`${config.base_url}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 16000,
          system,
          messages: [{ role: "user", content: body.prompt }],
        }),
      }),
    );
    output =
      result.content
        ?.filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("") ?? "";
  } else if (body.provider === "gemini") {
    if (!/^[a-zA-Z0-9._-]+$/.test(model))
      fail(400, "invalid_model", "Invalid Gemini model.");
    result = await jsonResponse(
      await upstream(`${config.base_url}/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.key,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: body.prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      }),
    );
    output =
      result.candidates?.[0]?.content?.parts
        ?.map((p: any) => p.text ?? "")
        .join("") ?? "";
  } else {
    result = await jsonResponse(
      await upstream(`${config.base_url}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.key}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: body.prompt },
          ],
          response_format: { type: "json_object" },
        }),
      }),
    );
    output = result.choices?.[0]?.message?.content ?? "";
  }
  let draft: unknown;
  try {
    draft = JSON.parse(
      output.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""),
    );
  } catch {
    fail(
      502,
      "invalid_generation",
      "Provider did not return a valid document. Your project was not changed.",
    );
  }
  const parsed = documentSchema.safeParse(draft);
  if (!parsed.success)
    fail(
      502,
      "invalid_generation",
      "Generated document failed validation. Your project was not changed.",
    );
  if (parsed.data.id !== row.id || parsed.data.kind !== row.kind)
    fail(
      502,
      "invalid_generation",
      "Provider changed document identity. Your project was not changed.",
    );
  await validateAssets(c, parsed.data);
  return c.json({
    document: parsed.data,
    usage: result.usage ?? result.usageMetadata,
  });
});

export const mediaInputSchema = z.object({
  kind: z.enum(["image", "audio", "video"]),
  prompt: z.string().trim().min(1).max(4000),
  provider: z.enum(["openai", "fal"]),
  model: z.string().min(1).max(200).optional(),
  voice: z.enum(["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"]).optional(),
  sourceAssetId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(120).optional(),
  durationSeconds: z.number().int().min(1).max(190).optional(),
  strength: z.number().min(0).max(1).optional(),
});
type MediaInput = z.infer<typeof mediaInputSchema>;
interface MediaSource { name: string; mimeType: string; bytes: ArrayBuffer }
const falModels = {
  image: "fal-ai/flux/dev",
  imageEdit: "fal-ai/flux/dev/image-to-image",
  video: defaults.fal.model,
  imageToVideo: "fal-ai/kling-video/v2.1/standard/image-to-video",
  videoEdit: "fal-ai/kling-video/o1/video-to-video/edit",
  audio: "fal-ai/stable-audio-25/text-to-audio",
  audioEdit: "fal-ai/stable-audio-25/audio-to-audio",
};

// Source inputs are internal owned bytes, never caller-controlled provider URLs.
export function buildMediaRequest(body: MediaInput, source?: MediaSource): { model: string; path: string; payload: FormData | Record<string, unknown> } {
  if (body.sourceAssetId && !source) fail(400, "source_asset_required", "The selected source asset is unavailable.");
  const sourceKind = source?.mimeType.split('/')[0];
  if (source && source.bytes.byteLength > 20 * 1024 * 1024) fail(413, "source_too_large", "Source media must be at most 20 MB.");
  if (body.provider === "openai") {
    if (body.kind === "video") fail(400, "unsupported_capability", "Choose fal for video generation or editing.");
    if (body.durationSeconds !== undefined || body.strength !== undefined) fail(400, "unsupported_option", "Duration and strength controls apply to supported fal models.");
    if (body.kind === "audio") {
      if (source) fail(400, "unsupported_capability", "OpenAI speech synthesis does not edit source audio. Choose fal for audio transformation.");
      const model = body.model ?? "gpt-4o-mini-tts";
      return { model, path: "/audio/speech", payload: { model, input: body.prompt, voice: body.voice ?? "coral", response_format: "mp3" } };
    }
    const model = body.model ?? "gpt-image-1";
    if (!source) return { model, path: "/images/generations", payload: { model, prompt: body.prompt, size: "1024x1024", n: 1 } };
    if (!["image/png", "image/jpeg", "image/webp"].includes(source.mimeType)) fail(400, "invalid_source_type", "Image editing requires an owned PNG, JPEG, or WebP asset.");
    if (!/^(gpt-image-[\w.-]+|chatgpt-image-latest)$/.test(model)) fail(400, "unsupported_model", "Select a GPT Image model for multipart source image editing.");
    const form = new FormData();
    form.set("model", model); form.set("prompt", body.prompt); form.set("n", "1"); form.set("size", "1024x1024"); form.set("output_format", "png");
    form.set("image[]", new File([source.bytes], source.name, { type: source.mimeType }));
    return { model, path: "/images/edits", payload: form };
  }
  if (body.voice !== undefined) fail(400, "unsupported_option", "The voice selector applies to OpenAI speech synthesis.");
  const defaultModel = body.kind === "image" ? (source ? falModels.imageEdit : falModels.image)
    : body.kind === "audio" ? (source ? falModels.audioEdit : falModels.audio)
    : sourceKind === "image" ? falModels.imageToVideo : source ? falModels.videoEdit : falModels.video;
  const model = body.model ?? defaultModel;
  if (!/^fal-ai\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)*$/.test(model)) fail(400, "invalid_model", "Use a fal-ai model path without URL parameters or traversal.");
  const payload: Record<string, unknown> = { prompt: body.prompt };
  if (body.kind === "image") {
    if (body.durationSeconds !== undefined) fail(400, "unsupported_option", "Image generation has no duration.");
    if (source && (sourceKind !== "image" || !["image/png", "image/jpeg", "image/webp"].includes(source.mimeType))) fail(400, "invalid_source_type", "fal image editing requires PNG, JPEG, or WebP source media.");
    if (source && model !== falModels.imageEdit) fail(400, "unsupported_model", `Source image editing supports ${falModels.imageEdit}; omit model to select it automatically.`);
    if (!source && model === falModels.imageEdit) fail(400, "source_asset_required", "This image editing model requires sourceAssetId.");
    if (body.strength !== undefined && !source) fail(400, "unsupported_option", "Strength requires a source image or audio clip.");
    if (source) payload.image_url = `data:${source.mimeType};base64,${Buffer.from(source.bytes).toString('base64')}`;
    if (body.strength !== undefined) payload.strength = body.strength;
    payload.num_images = 1;
  } else if (body.kind === "audio") {
    if (source && !["audio/mpeg", "audio/wav", "audio/ogg"].includes(source.mimeType)) fail(400, "invalid_source_type", "Audio transformation requires MP3, WAV, or OGG source media.");
    const expected = source ? falModels.audioEdit : falModels.audio;
    if (model !== expected) fail(400, "unsupported_model", `This audio mode supports ${expected}; omit model to select it automatically.`);
    if (source) payload.audio_url = `data:${source.mimeType};base64,${Buffer.from(source.bytes).toString('base64')}`;
    if (body.strength !== undefined) { if (!source) fail(400, "unsupported_option", "Strength requires a source audio clip."); payload.strength = body.strength; }
    if (body.durationSeconds !== undefined) payload[source ? 'total_seconds' : 'seconds_total'] = body.durationSeconds;
    else if (!source) payload.seconds_total = 30;
  } else {
    if (body.strength !== undefined) fail(400, "unsupported_option", "Kling video modes do not accept strength.");
    if (sourceKind === "image") {
      if (!["image/png", "image/jpeg", "image/webp"].includes(source!.mimeType)) fail(400, "invalid_source_type", "Image-to-video requires PNG, JPEG, or WebP.");
      if (model !== falModels.imageToVideo) fail(400, "unsupported_model", `Image-to-video supports ${falModels.imageToVideo}; omit model to select it automatically.`);
      payload.image_url = `data:${source!.mimeType};base64,${Buffer.from(source!.bytes).toString('base64')}`;
    } else if (source) {
      if (source.mimeType !== "video/mp4") fail(400, "invalid_source_type", "Video editing requires MP4 source media (Kling O1: 3–10 seconds, 720–2160px). Convert other formats before uploading.");
      if (model !== falModels.videoEdit) fail(400, "unsupported_model", `Video editing supports ${falModels.videoEdit}; omit model to select it automatically.`);
      if (body.durationSeconds !== undefined) fail(400, "unsupported_option", "Kling O1 editing preserves source timing and does not accept a duration override.");
      payload.video_url = `data:${source.mimeType};base64,${Buffer.from(source.bytes).toString('base64')}`;
    } else if ([falModels.imageToVideo, falModels.videoEdit].includes(model)) fail(400, "source_asset_required", "This video model requires sourceAssetId.");
    if (body.durationSeconds !== undefined) {
      if (![5, 10].includes(body.durationSeconds) || ![falModels.video, falModels.imageToVideo].includes(model)) fail(400, "unsupported_option", "Duration supports 5 or 10 seconds on the default Kling generation models.");
      payload.duration = String(body.durationSeconds);
    }
  }
  return { model, path: `/${model}`, payload };
}

async function sourceAsset(c: Context<Env>, projectId: string, sourceId?: string): Promise<MediaSource | undefined> {
  if (!sourceId) return undefined;
  const row = await c.env.DB.prepare('SELECT name,mime_type,storage_key FROM assets WHERE id=? AND project_id=? AND user_id=?')
    .bind(sourceId, projectId, owner(c)).first<{name:string;mime_type:string;storage_key:string}>();
  if (!row) fail(404, "source_asset_not_found", "Source asset must belong to this project. Upload or clone the asset into this project first.");
  const object = await c.env.ASSETS_BUCKET.get(row.storage_key);
  if (!object) fail(404, "source_asset_not_found", "The source asset bytes are unavailable.");
  return { name: row.name, mimeType: row.mime_type, bytes: await object.arrayBuffer() };
}

generationRoutes.post("/:id/media", async c => {
  const project = await projectRow(c, c.req.param("id"));
  const body = mediaInputSchema.parse(await c.req.json());
  const source = await sourceAsset(c, project.id, body.sourceAssetId);
  const request = buildMediaRequest(body, source);
  const config = await providerConfig(c, body.provider);
  await rateLimit(c, `media:${owner(c)}`, 30);
  const multipart = request.payload instanceof FormData;
  const response = await upstream(`${config.base_url}${request.path}`, {
    method: "POST",
    headers: { Authorization: `${body.provider === 'fal' ? 'Key' : 'Bearer'} ${config.key}`, ...(multipart ? {} : { 'Content-Type': 'application/json' }) },
    body: multipart ? request.payload as FormData : JSON.stringify(request.payload),
  });
  if (body.provider === "fal") {
    const result = await jsonResponse(response);
    if (typeof result.request_id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(result.request_id)) fail(502, "invalid_provider_response", "Provider returned no valid request ID.");
    const jobId = id();
    await c.env.DB.prepare('INSERT INTO media_jobs(id,user_id,project_id,provider,remote_id,model,kind,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(jobId, owner(c), project.id, 'fal', result.request_id, request.model, body.kind, now()).run();
    return c.json({ job: { id: jobId, status: 'queued' } }, 202);
  }
  if (body.kind === 'audio') return c.json({ asset: await storeAsset(c, project.id, 'Generated speech.mp3', 'audio/mpeg', await limitedBytes(response, 20 * 1024 * 1024)) });
  const result = await jsonResponse(response), encoded = result.data?.[0]?.b64_json;
  if (typeof encoded !== 'string' || encoded.length > 28 * 1024 * 1024) fail(502, 'invalid_provider_response', 'Image provider did not return bounded image bytes. Choose a model supporting base64 output.');
  let bytes: ArrayBuffer;
  try { bytes = unb64(encoded).buffer as ArrayBuffer; } catch { fail(502, 'invalid_provider_response', 'Image provider returned invalid base64.'); }
  return c.json({ asset: await storeAsset(c, project.id, source ? 'Edited image.png' : 'Generated image.png', 'image/png', bytes) });
});

export function falResultFile(result: unknown, kind: MediaInput['kind']): { url: string; mimeType?: string } {
  const body = z.record(z.string(), z.unknown()).safeParse(result);
  if (!body.success || body.data.error || body.data.detail) fail(502, 'media_generation_failed', 'The provider could not generate this media. Check the model requirements and source dimensions/duration.');
  const value = kind === 'image' ? (Array.isArray(body.data.images) ? body.data.images[0] : undefined) : body.data[kind];
  const file = typeof value === 'string' ? { url: value } : z.object({ url: z.string(), content_type: z.string().optional() }).safeParse(value).data;
  if (!file) fail(502, 'invalid_provider_response', `Provider returned no ${kind} file.`);
  let url: URL;
  try { url = new URL(file.url); } catch { fail(502, 'invalid_media_url', 'Provider returned an invalid media location.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media'))) fail(502, 'invalid_media_url', 'Provider returned an untrusted media location.');
  return { url: url.href, mimeType: 'content_type' in file ? file.content_type : undefined };
}

generationRoutes.get("/:id/media/:jobId", async c => {
  await projectRow(c, c.req.param('id'));
  const job = await c.env.DB.prepare('SELECT * FROM media_jobs WHERE id=? AND user_id=? AND project_id=?')
    .bind(c.req.param('jobId'), owner(c), c.req.param('id')).first<{model:string;remote_id:string;kind:MediaInput['kind'];result_asset:string|null}>();
  if (!job) fail(404, 'not_found', 'Media job not found.');
  if (job.result_asset) return c.json({ status: 'completed', asset: JSON.parse(job.result_asset) });
  const config = await providerConfig(c, 'fal');
  const endpoint = job.model.split('/').slice(0, 2).join('/');
  const headers = { Authorization: `Key ${config.key}` };
  const status = await jsonResponse(await upstream(`${config.base_url}/${endpoint}/requests/${job.remote_id}/status`, { headers }));
  if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') return c.json({ status: status.status === 'IN_PROGRESS' ? 'processing' : 'queued' });
  if (status.status !== 'COMPLETED') fail(502, 'media_generation_failed', 'Provider job failed or returned an unknown status. Check source requirements and retry generation if appropriate.');
  const result = await jsonResponse(await upstream(`${config.base_url}/${endpoint}/requests/${job.remote_id}`, { headers }));
  const file = falResultFile(result, job.kind ?? 'video');
  const response = await upstream(file.url, {});
  const headerMime = response.headers.get('Content-Type')?.split(';')[0];
  const mime = headerMime && headerMime !== 'application/octet-stream' ? headerMime : file.mimeType ?? ({ image: 'image/jpeg', audio: 'audio/wav', video: 'video/mp4' }[job.kind ?? 'video']);
  const extensions: Record<string,string> = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','audio/wav':'wav','audio/mpeg':'mp3','audio/ogg':'ogg','video/mp4':'mp4','video/webm':'webm'};
  if (!extensions[mime] || !mime.startsWith(`${job.kind ?? 'video'}/`)) { await response.body?.cancel(); fail(502, 'invalid_media_type', 'Provider output media type does not match the requested kind.'); }
  const asset = await storeAsset(c, c.req.param('id'), `Generated ${job.kind ?? 'video'}.${extensions[mime]}`, mime, await limitedBytes(response, 20 * 1024 * 1024));
  const saved = await c.env.DB.prepare('UPDATE media_jobs SET result_asset=? WHERE id=? AND user_id=? AND result_asset IS NULL')
    .bind(JSON.stringify(asset), c.req.param('jobId'), owner(c)).run();
  if (!saved.meta.changes) {
    const duplicate = await c.env.DB.prepare('SELECT storage_key FROM assets WHERE id=? AND user_id=?').bind(asset.id, owner(c)).first<{storage_key:string}>();
    await c.env.DB.prepare('DELETE FROM assets WHERE id=? AND user_id=?').bind(asset.id, owner(c)).run();
    if (duplicate) await c.env.ASSETS_BUCKET.delete(duplicate.storage_key);
    const current = await c.env.DB.prepare('SELECT result_asset FROM media_jobs WHERE id=? AND user_id=?').bind(c.req.param('jobId'), owner(c)).first<{result_asset:string|null}>();
    if (!current?.result_asset) fail(404, 'not_found', 'Media job was deleted.');
    return c.json({ status: 'completed', asset: JSON.parse(current.result_asset) });
  }
  return c.json({ status: 'completed', asset });
});
