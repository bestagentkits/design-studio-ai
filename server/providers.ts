import { buildTextRequest } from './text-provider-request';
import { mediaInputSchema, generationInputSchema } from '../src/shared/provider-requests';
import { buildImageRequest, decodeImageResult, imageMime, leonardoJob } from './image-providers';
import { withSpan, providerUsage, completeMediaSpan, errorCode } from './observability';
import { Hono } from "hono";
import { z } from "zod";
import type { Context } from "hono";
import type { Env } from "./types";
import { fail, id, now, owner, rateLimit } from "./security";
import { projectRow, storeAsset, validateAssets } from "./projects";
import { documentSchema } from "../src/shared/schema";
import type { DesignBrief } from '../src/shared/brief';
import { providerConfig, providerHeaders, providerRoutes } from './provider-connections';
import { providerCatalog as defaults, textProviderSchema, isCustomProvider } from '../src/shared/providers';
export { providerConfig, providerRoutes, textProviderSchema };
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
      redirect: "manual",
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
export async function jsonResponse(response: Response) {
  try {
    const result = JSON.parse(new TextDecoder().decode(await limitedBytes(response, 29 * 1024 * 1024)));
    if (!result || typeof result !== 'object' || Array.isArray(result)) fail(502, 'invalid_provider_response', 'Provider returned an invalid response object.');
    return result;
  } catch (error) {
    if (error instanceof SyntaxError)
      fail(502, "invalid_provider_response", "Provider returned invalid JSON.");
    throw error;
  }
}
export async function completeText(c: Context<Env>, body: {
  provider: z.infer<typeof textProviderSchema>; model?: string; system: string; prompt: string; maxTokens?: number;
}) {
  return withSpan(c, { kind: 'provider', action: 'provider.text', provider: body.provider, model: body.model, projectId: c.get('telemetrySpan')?.event.projectId ?? undefined }, async span => {
  const config = await providerConfig(c, body.provider);
  const model = body.model ?? config.model;
  span.set({ model });
  const request = buildTextRequest(config, { ...body, model });
  const result = await jsonResponse(await upstream(request.url, request.init));
  const output = config.protocol === 'anthropic' ? result.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('') ?? ''
    : config.protocol === 'gemini' ? result.candidates?.[0]?.content?.parts?.filter((p: any) => !p.thought).map((p: any) => p.text ?? '').join('') ?? ''
    : result.choices?.[0]?.message?.content ?? '';
  span.set(providerUsage(result.usage ?? result.usageMetadata, body.provider));
  if (typeof output === 'string') span.set({ outputBytes: new TextEncoder().encode(output).length });
  if (typeof output !== 'string') fail(502, 'invalid_provider_response', 'Provider did not return text content.');
  return { output, usage: result.usage ?? result.usageMetadata };
  });
}

export const generationRoutes = new Hono<Env>();
generationRoutes.post("/:id/generate", async (c) => {
  const row = await projectRow(c, c.req.param("id"));
  const body = generationInputSchema.parse(await c.req.json());
  if (body.expectedRevision !== row.revision) fail(409, 'revision_conflict', 'Reload the project before generating.');
  const savedBrief = await c.env.DB.prepare('SELECT brief,revision FROM design_briefs WHERE project_id=? AND user_id=?').bind(row.id, owner(c)).first<{ brief: string; revision: number }>();
  const brief = savedBrief ? JSON.parse(savedBrief.brief) as DesignBrief : null;
  if (brief && (brief.status !== 'approved' || !brief.scope || !brief.approvedAt)) fail(409, 'brief_not_approved', 'Review and explicitly approve the project scope before generating.');
  const system = 'You edit DesignDocument v1 JSON. Return only the complete valid document, no prose or markdown. Preserve id and kind and existing useful content unless asked. Nodes have finite pixel x,y,width,height; type frame,group,component,text,image,shape,icon,chart,model3d,video,audio. Prefer structured flex/grid page and container layout for Web/App designs: layout has mode, direction row/column, gap,padding,align,justify,wrap,columns. sizing width/height uses fixed/hug/fill. Explicit absolute containers use local child coordinates; containers with no layout keep legacy page-space coordinates. Components use component:{name,system:antd or shadcn,props:{label,...}}; available names Button,Checkbox,Input,InputNumber,Slider,Image,Avatar,List,Statistics,Chart,Table,Select,Switch,Textarea,Card,Badge,Progress,Tabs,Dialog,Radio. Parent IDs must exist on the same page. Text belongs in text, styles in style. Timeline keyframes support linear,easeIn,easeOut,easeInOut,bounce,spring,step or a cubic bezier tuple. Mesh geometry/UV/materials/bones belong in scene; preserve existing mesh data unless specifically editing it. Never return executable code, scripts, event handlers, or javascript URLs. Preserve schemaVersion, theme, pages, assets and metadata. '
    + (brief ? `The user explicitly approved this scope. Fulfill its objective, audience, direction, deliverables, constraints and acceptance criteria: ${JSON.stringify(brief.scope)}. ` : '')
    + 'Current document: ' + row.document;
  const { output, usage } = await completeText(c, { provider: body.provider, model: body.model, system, prompt: body.prompt });
  const currentBrief = await c.env.DB.prepare('SELECT revision FROM design_briefs WHERE project_id=? AND user_id=?').bind(row.id, owner(c)).first<{ revision: number }>();
  if ((currentBrief?.revision ?? 0) !== (savedBrief?.revision ?? 0)) fail(409, 'revision_conflict', 'The brief changed during generation. Review its latest scope before generating again.');
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
    usage,
  });
});

export { mediaInputSchema } from '../src/shared/provider-requests';
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
  if (body.provider !== 'openai' && body.provider !== 'fal') {
    if (!['gemini', 'grok', 'leonardo'].includes(body.provider)) fail(400, 'unsupported_capability', 'Custom media requires a configured OpenAI or Gemini API format.');
    if (body.kind !== 'image' || source) fail(400, 'unsupported_capability', 'This connection supports prompt-only image generation. Choose OpenAI or fal for source editing.');
    if (body.voice !== undefined || body.durationSeconds !== undefined || body.strength !== undefined) fail(400, 'unsupported_option', 'Voice, duration and strength do not apply to image generation.');
    return buildImageRequest(body.provider as 'gemini' | 'grok' | 'leonardo', body.prompt, body.model);
  }
  if (body.provider === "openai") {
    if (body.kind === "video") fail(400, "unsupported_capability", "Choose fal for video generation or editing.");
    if (body.durationSeconds !== undefined || body.strength !== undefined) fail(400, "unsupported_option", "Duration and strength controls apply to supported fal models.");
    if (body.kind === "audio") {
      if (source) fail(400, "unsupported_capability", "OpenAI speech synthesis does not edit source audio. Choose fal for audio transformation.");
      const model = body.model ?? "gpt-4o-mini-tts";
      return { model, path: "/audio/speech", payload: { model, input: body.prompt, voice: body.voice ?? "coral", response_format: "mp3" } };
    }
    if (body.voice !== undefined) fail(400, 'unsupported_option', 'The voice selector applies only to speech.');
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
  return withSpan(c, { kind: 'provider', action: ['fal', 'leonardo'].includes(body.provider) ? 'provider.media.job' : `provider.media.${body.kind}`, projectId: project.id, provider: body.provider, model: body.model }, async span => {
  const config = await providerConfig(c, body.provider);
  let requestBody = body;
  if (isCustomProvider(body.provider)) {
    if (config.protocol === 'anthropic' || body.kind !== 'image' || source) fail(400, 'unsupported_capability', 'Custom connections support prompt-only images using OpenAI or Gemini API format.');
    requestBody = { ...body, provider: config.protocol, model: body.model ?? config.model };
  } else if (['grok', 'leonardo'].includes(body.provider)) requestBody = { ...body, model: body.model ?? config.model };
  const request = buildMediaRequest(requestBody, source);
  if (isCustomProvider(body.provider) && config.protocol === 'openai' && !/^(gpt-image-|chatgpt-image-)/.test(request.model)) (request.payload as Record<string, unknown>).response_format = 'b64_json';
  span.set({ model: request.model });
  await rateLimit(c, `media:${owner(c)}`, 30);
  const multipart = request.payload instanceof FormData;
  const response = await upstream(`${config.base_url}${request.path}`, {
    method: "POST",
    headers: { ...providerHeaders(config), ...(multipart ? {} : { 'Content-Type': 'application/json' }) },
    body: multipart ? request.payload as FormData : JSON.stringify(request.payload),
  });
  if (body.provider === "fal" || body.provider === 'leonardo') {
    const result = await jsonResponse(response);
    result.request_id = body.provider === 'leonardo' ? result.sdGenerationJob?.generationId : result.request_id;
    if (typeof result.request_id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(result.request_id)) fail(502, "invalid_provider_response", "Provider returned no valid request ID.");
    const jobId = id();
    await c.env.DB.prepare('INSERT INTO media_jobs(id,user_id,project_id,provider,remote_id,model,kind,created_at,observability_span_id) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(jobId, owner(c), project.id, body.provider, result.request_id, request.model, body.kind, now(), span.event.id).run();
    span.pending = true;
    return c.json({ job: { id: jobId, status: 'queued' } }, 202);
  }
  if (body.kind === 'audio') { const bytes = await limitedBytes(response, 20 * 1024 * 1024); span.set({ outputBytes: bytes.byteLength }); return c.json({ asset: await storeAsset(c, project.id, 'Generated speech.mp3', 'audio/mpeg', bytes) }); }
  const result = await jsonResponse(response);
  span.set(providerUsage(result.usage ?? result.usageMetadata, body.provider));
  const image = decodeImageResult(result, config.protocol);
  span.set({ outputBytes: image.bytes.byteLength });
  return c.json({ asset: await storeAsset(c, project.id, `${source ? 'Edited' : 'Generated'} image.${image.extension}`, image.mimeType, image.bytes) });
  });
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
    .bind(c.req.param('jobId'), owner(c), c.req.param('id')).first<{provider:string;model:string;remote_id:string;kind:MediaInput['kind'];result_asset:string|null;observability_span_id:string|null}>();
  if (!job) fail(404, 'not_found', 'Media job not found.');
  if (job.result_asset) { const asset = JSON.parse(job.result_asset); await completeMediaSpan(c, job.observability_span_id, { outputBytes: asset.size }); return c.json({ status: 'completed', asset }); }
  const config = await providerConfig(c, job.provider);
  if (!/^[a-zA-Z0-9_-]+$/.test(job.remote_id)) fail(502, 'invalid_provider_response', 'Invalid stored provider job ID.');
  const headers = providerHeaders(config);
  let result: any;
  let file: { url: string; mimeType?: string };
  try {
  if (job.provider === 'leonardo') {
    result = await jsonResponse(await upstream(`${config.base_url}/generations/${job.remote_id}`, { headers }));
    const state = leonardoJob(result);
    if (state.status === 'processing') return c.json({ status: 'processing' });
    file = { url: state.url! };
  } else if (job.provider === 'fal') {
    const endpoint = job.model.split('/').slice(0, 2).join('/');
    const status = await jsonResponse(await upstream(`${config.base_url}/${endpoint}/requests/${job.remote_id}/status`, { headers }));
    if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') return c.json({ status: status.status === 'IN_PROGRESS' ? 'processing' : 'queued' });
    if (status.status !== 'COMPLETED') fail(502, 'media_generation_failed', 'Provider job failed or returned an unknown status.');
    result = await jsonResponse(await upstream(`${config.base_url}/${endpoint}/requests/${job.remote_id}`, { headers }));
    file = falResultFile(result, job.kind ?? 'video');
  } else fail(400, 'unsupported_provider', 'Unsupported media job provider.');
  const response = await upstream(file.url, {});
  const headerMime = response.headers.get('Content-Type')?.split(';')[0];
  let mime = headerMime && headerMime !== 'application/octet-stream' ? headerMime : file.mimeType ?? ({ image: 'image/jpeg', audio: 'audio/wav', video: 'video/mp4' }[job.kind ?? 'video']);
  const extensions: Record<string,string> = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','audio/wav':'wav','audio/mpeg':'mp3','audio/ogg':'ogg','video/mp4':'mp4','video/webm':'webm'};
  if (!extensions[mime] || !mime.startsWith(`${job.kind ?? 'video'}/`)) { await response.body?.cancel(); fail(502, 'invalid_media_type', 'Provider output media type does not match the requested kind.'); }
  const bytes = await limitedBytes(response, 20 * 1024 * 1024);
  if (job.provider === 'leonardo') {
    const detected = imageMime(new Uint8Array(bytes));
    if (headerMime && headerMime !== 'application/octet-stream' && detected !== mime) fail(502, 'invalid_media_type', 'Leonardo image bytes do not match the media type.');
    mime = detected;
  }
  const asset = await storeAsset(c, c.req.param('id'), `Generated ${job.kind ?? 'video'}.${extensions[mime]}`, mime, bytes);
  const saved = await c.env.DB.prepare('UPDATE media_jobs SET result_asset=? WHERE id=? AND user_id=? AND result_asset IS NULL')
    .bind(JSON.stringify(asset), c.req.param('jobId'), owner(c)).run();
  if (!saved.meta.changes) {
    const duplicate = await c.env.DB.prepare('SELECT storage_key FROM assets WHERE id=? AND user_id=?').bind(asset.id, owner(c)).first<{storage_key:string}>();
    await c.env.DB.prepare('DELETE FROM assets WHERE id=? AND user_id=?').bind(asset.id, owner(c)).run();
    if (duplicate) await c.env.ASSETS_BUCKET.delete(duplicate.storage_key);
    const current = await c.env.DB.prepare('SELECT result_asset FROM media_jobs WHERE id=? AND user_id=?').bind(c.req.param('jobId'), owner(c)).first<{result_asset:string|null}>();
    if (!current?.result_asset) fail(404, 'not_found', 'Media job was deleted.');
    const retainedAsset = JSON.parse(current.result_asset);
    await completeMediaSpan(c, job.observability_span_id, { outputBytes: retainedAsset.size, usage: result.usage });
    return c.json({ status: 'completed', asset: retainedAsset });
  }
  await completeMediaSpan(c, job.observability_span_id, { outputBytes: asset.size, usage: result.usage });
  return c.json({ status: 'completed', asset });
  } catch (error) {
    await completeMediaSpan(c, job.observability_span_id, { usage: result?.usage, errorCode: errorCode(error) });
    throw error;
  }
});
