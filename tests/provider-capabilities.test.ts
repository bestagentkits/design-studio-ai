import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { app } from '../server/index';
import { FileBucket, SqliteDatabase } from '../server/node-adapters';
import { ApiError, secret } from '../server/security';
import { buildMediaRequest, falResultFile, mediaInputSchema } from '../server/providers';
import type { Bindings } from '../server/types';

const bytes = new Uint8Array([1, 2, 3]).buffer;
const request = (overrides: Record<string, unknown>) => mediaInputSchema.parse({ kind: 'image', provider: 'openai', prompt: 'Refine the composition', ...overrides });
const errorCode = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;

test('OpenAI editing constructs actual multipart file input with no public source URL', async () => {
  const plan = buildMediaRequest(request({ sourceAssetId: 'owned-image' }), { name: 'reference.png', mimeType: 'image/png', bytes });
  assert.equal(plan.path, '/images/edits'); assert.ok(plan.payload instanceof FormData);
  const image = plan.payload.get('image[]'); assert.ok(image instanceof File);
  assert.deepEqual(await image.arrayBuffer(), bytes); assert.equal(image.type, 'image/png');
  assert.equal(plan.payload.get('prompt'), 'Refine the composition'); assert.equal(plan.payload.get('output_format'), 'png');
  assert.equal(plan.payload.has('image_url'), false);
});

test('fal source-conditioned models receive owned data URIs in documented fields', () => {
  const image = buildMediaRequest(request({ provider: 'fal', sourceAssetId: 'image', strength: 0.6 }), { name: 'image.png', mimeType: 'image/png', bytes });
  assert.equal(image.model, 'fal-ai/flux/dev/image-to-image'); assert.deepEqual(image.payload, { prompt: 'Refine the composition', image_url: 'data:image/png;base64,AQID', strength: 0.6, num_images: 1 });
  const video = buildMediaRequest(request({ provider: 'fal', kind: 'video', sourceAssetId: 'video' }), { name: 'video.mp4', mimeType: 'video/mp4', bytes });
  assert.equal(video.model, 'fal-ai/kling-video/o1/video-to-video/edit'); assert.equal((video.payload as any).video_url, 'data:video/mp4;base64,AQID');
  const motion = buildMediaRequest(request({ provider: 'fal', kind: 'video', sourceAssetId: 'image', durationSeconds: 10 }), { name: 'image.png', mimeType: 'image/png', bytes });
  assert.equal(motion.model, 'fal-ai/kling-video/v2.1/standard/image-to-video'); assert.equal((motion.payload as any).duration, '10');
});

test('Stable Audio maps text and source audio duration options without pretending to synthesize speech', () => {
  const music = buildMediaRequest(request({ provider: 'fal', kind: 'audio', durationSeconds: 20 }));
  assert.equal(music.model, 'fal-ai/stable-audio-25/text-to-audio'); assert.equal((music.payload as any).seconds_total, 20);
  const edit = buildMediaRequest(request({ provider: 'fal', kind: 'audio', sourceAssetId: 'audio', durationSeconds: 8, strength: 0.4 }), { name: 'source.wav', mimeType: 'audio/wav', bytes });
  assert.equal(edit.model, 'fal-ai/stable-audio-25/audio-to-audio'); assert.equal((edit.payload as any).total_seconds, 8); assert.equal((edit.payload as any).audio_url, 'data:audio/wav;base64,AQID');
  assert.throws(() => buildMediaRequest(request({ provider: 'fal', kind: 'audio', voice: 'coral' })), errorCode('unsupported_option'));
});

test('unsupported source/model combinations and excessive input fail before provider calls', () => {
  assert.throws(() => buildMediaRequest(request({ provider: 'openai', kind: 'video' })), errorCode('unsupported_capability'));
  assert.throws(() => buildMediaRequest(request({ provider: 'openai', kind: 'audio', sourceAssetId: 'audio' }), { name: 'speech.wav', mimeType: 'audio/wav', bytes }), errorCode('unsupported_capability'));
  assert.throws(() => buildMediaRequest(request({ provider: 'fal', sourceAssetId: 'image', model: 'fal-ai/flux/dev' }), { name: 'image.png', mimeType: 'image/png', bytes }), errorCode('unsupported_model'));
  assert.throws(() => buildMediaRequest(request({ provider: 'fal', kind: 'video', sourceAssetId: 'video' }), { name: 'video.webm', mimeType: 'video/webm', bytes }), errorCode('invalid_source_type'));
  assert.throws(() => buildMediaRequest(request({ provider: 'fal', kind: 'video', durationSeconds: 190 })), errorCode('unsupported_option'));
  assert.throws(() => buildMediaRequest(request({ provider: 'fal', model: 'fal-ai/../secret' })), errorCode('invalid_model'));
  assert.equal(mediaInputSchema.safeParse({ kind: 'audio', provider: 'fal', prompt: 'sound', durationSeconds: 191 }).success, false);
  assert.equal(mediaInputSchema.safeParse({ kind: 'image', provider: 'openai', prompt: ' ' }).success, false);
});

test('fal output interpretation enforces kind and trusted HTTPS locations', () => {
  assert.throws(() => falResultFile({ video: { url: 'http://127.0.0.1/private' } }, 'video'), errorCode('invalid_media_url'));
  assert.throws(() => falResultFile({ audio: { url: 'https://fal.media.evil.test/audio.wav' } }, 'audio'), errorCode('invalid_media_url'));
  assert.throws(() => falResultFile({ audio: { url: 'https://user:secret@fal.media/audio.wav' } }, 'audio'), errorCode('invalid_media_url'));
  assert.throws(() => falResultFile({ video: { url: 'https://fal.media/video.mp4' } }, 'audio'), errorCode('invalid_provider_response'));
  assert.throws(() => falResultFile({ error: 'Private provider diagnostics' }, 'image'), errorCode('media_generation_failed'));
});

test('real SQLite source ownership, unconfigured providers, and cached media polls preserve isolation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsa-provider-test-'));
  const database = new SqliteDatabase(join(directory, 'database.sqlite'));
  t.after(async () => { database.close(); assert.ok(resolve(directory).startsWith(resolve(tmpdir()))); assert.ok(basename(directory).startsWith('dsa-provider-test-')); await rm(directory, { recursive: true, force: true }); });
  for (const file of (await readdir(resolve('migrations'))).filter(name => name.endsWith('.sql')).sort()) await database.exec(await readFile(resolve('migrations', file), 'utf8'));
  const env: Bindings = { DB: database, ASSETS_BUCKET: new FileBucket(join(directory, 'assets')), APP_URL: 'https://provider-test.example', ALLOW_REGISTRATION: 'true', ENCRYPTION_KEY: secret() };
  async function api(path: string, method = 'GET', body?: unknown, cookie?: string) {
    return app.request(`https://provider-test.example${path}`, { method, headers: { Origin: env.APP_URL!, ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) }, env);
  }
  const registered = await api('/api/auth/register', 'POST', { email: 'media-owner@example.test', password: 'media-test-password-123' });
  assert.equal(registered.status, 201); const user = (await registered.json()).user; const cookie = registered.headers.get('Set-Cookie')!.split(';')[0];
  const otherRegistered = await api('/api/auth/register', 'POST', { email: 'media-other@example.test', password: 'media-test-password-456' });
  assert.equal(otherRegistered.status, 201); const otherCookie = otherRegistered.headers.get('Set-Cookie')!.split(';')[0];
  const create = async (name: string, auth = cookie) => (await (await api('/api/projects', 'POST', { name }, auth)).json()).project;
  const first = await create('First'), second = await create('Second'), other = await create('Other owner', otherCookie);
  const form = new FormData();
  form.set('file', new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')], 'pixel.png', { type: 'image/png' }));
  const uploaded = await api(`/api/projects/${first.id}/assets`, 'POST', form, cookie); assert.equal(uploaded.status, 201); const asset = (await uploaded.json()).asset;
  const sourceBody = { kind: 'image', provider: 'openai', prompt: 'Edit the image', sourceAssetId: asset.id };
  const sameOwnerWrongProject = await api(`/api/projects/${second.id}/media`, 'POST', sourceBody, cookie);
  assert.equal(sameOwnerWrongProject.status, 404); assert.equal((await sameOwnerWrongProject.json()).error.code, 'source_asset_not_found');
  const otherOwner = await api(`/api/projects/${other.id}/media`, 'POST', sourceBody, otherCookie);
  assert.equal(otherOwner.status, 404); assert.equal((await otherOwner.json()).error.code, 'source_asset_not_found');
  const missingKey = await api(`/api/projects/${first.id}/media`, 'POST', sourceBody, cookie);
  assert.equal(missingKey.status, 400); assert.equal((await missingKey.json()).error.code, 'provider_unconfigured');
  const musicMissingKey = await api(`/api/projects/${first.id}/media`, 'POST', { kind: 'audio', provider: 'fal', prompt: 'Soft piano music' }, cookie);
  assert.equal((await musicMissingKey.json()).error.code, 'provider_unconfigured');
  const jobId = crypto.randomUUID();
  await database.prepare('INSERT INTO media_jobs(id,user_id,project_id,provider,remote_id,model,kind,result_asset,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(jobId, user.id, first.id, 'fal', 'completed-persisted-request', 'fal-ai/flux/dev', 'image', JSON.stringify(asset), new Date().toISOString()).run();
  const countBefore = (await database.prepare('SELECT COUNT(*) AS count FROM assets').first<{count:number}>())!.count;
  for (let index = 0; index < 2; index++) { const polled = await api(`/api/projects/${first.id}/media/${jobId}`, 'GET', undefined, cookie); assert.equal(polled.status, 200); assert.deepEqual(await polled.json(), { status: 'completed', asset }); }
  assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM assets').first<{count:number}>())!.count, countBefore);
  assert.equal((await api(`/api/projects/${second.id}/media/${jobId}`, 'GET', undefined, cookie)).status, 404);
  assert.equal((await api(`/api/projects/${first.id}/media/${jobId}`, 'GET', undefined, otherCookie)).status, 404);
});
