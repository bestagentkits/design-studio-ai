import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { buildMediaRequest, mediaInputSchema, upstream } from '../server/providers';
import { allowedProviderBase, providerHeaders } from '../server/provider-connections';
import { buildTextRequest } from '../server/text-provider-request';
import { buildImageRequest, decodeImageResult, leonardoJob } from '../server/image-providers';
import { providerCatalog, providerSettingsSchema, textProviderSchema } from '../src/shared/providers';
import { modelDiscoveryRequest, parseModelPage } from '../server/discovery';
import { ApiError } from '../server/security';

const errorCode = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
const body = { model: 'model-id', prompt: 'Design a page', system: 'Return JSON', maxTokens: 2000 };

test('DeepSeek and custom text requests use the selected API format and authentication', () => {
  const official = buildTextRequest({ provider: 'deepseek', protocol: 'openai', base_url: providerCatalog.deepseek.baseUrl, key: 'unit-test-credential', authMethod: 'bearer' }, { ...body, model: providerCatalog.deepseek.model });
  assert.equal(official.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(official.init.headers.Authorization, 'Bearer unit-test-credential');
  assert.deepEqual(JSON.parse(official.init.body), { model: 'deepseek-flash', messages: [{ role: 'system', content: 'Return JSON' }, { role: 'user', content: 'Design a page' }], response_format: { type: 'json_object' }, max_tokens: 2000 });
  for (const protocol of ['openai', 'anthropic', 'gemini'] as const) {
    const request = buildTextRequest({ provider: 'custom-team', protocol, base_url: 'https://team.example/v1', key: 'user:password', authMethod: 'basic' }, body);
    const pathname = new URL(request.url).pathname, payload = JSON.parse(request.init.body);
    assert.equal(new URL(request.url).origin, 'https://team.example');
    assert.equal(request.init.headers.Authorization, `Basic ${btoa('user:password')}`);
    assert.equal(request.init.headers['x-goog-api-key'], undefined);
    assert.equal(request.init.headers['x-api-key'], undefined);
    if (protocol === 'openai') { assert.equal(pathname, '/v1/chat/completions'); assert.equal(payload.response_format.type, 'json_object'); }
    if (protocol === 'anthropic') { assert.equal(pathname, '/v1/messages'); assert.equal(request.init.headers['anthropic-version'], '2023-06-01'); assert.equal(payload.system, 'Return JSON'); assert.equal(payload.messages[0].content, 'Design a page'); }
    if (protocol === 'gemini') { assert.equal(pathname, '/v1/models/model-id:generateContent'); assert.equal(payload.systemInstruction.parts[0].text, 'Return JSON'); assert.equal(payload.contents[0].parts[0].text, 'Design a page'); }
  }
  assert.deepEqual(providerHeaders({ provider: 'custom-team', authMethod: 'none', key: 'never-transmitted' }), {});
  assert.deepEqual(providerHeaders({ provider: 'custom-team', authMethod: 'api-key', authHeader: 'X-Team-Key', key: 'unit-test-value' }), { 'X-Team-Key': 'unit-test-value' });
  assert.equal(textProviderSchema.safeParse('custom-team').success, true);
  for (const provider of ['fal', 'leonardo', 'grok']) assert.equal(textProviderSchema.safeParse(provider).success, false);
});

test('provider URL and header checks preserve the operator trust boundary', () => {
  assert.equal(allowedProviderBase('custom-team', 'https://team.example/v1/', 'https://team.example'), 'https://team.example/v1');
  for (const url of ['http://team.example/v1', 'https://team.example.evil.test', 'https://user:pass@team.example/v1', 'https://team.example/v1?key=secret', 'https://team.example/#fragment', 'invalid-url', 'https://127.0.0.1/v1']) {
    assert.throws(() => allowedProviderBase('custom-team', url, 'https://team.example'), errorCode('invalid_provider_url'));
  }
  for (const authHeader of ['Host', 'Cookie', 'Content-Type', 'Content-Length', 'Proxy-Authorization', 'X-Forwarded-Host', 'Connection', 'X-Key\r\nHost']) assert.equal(providerSettingsSchema.safeParse({ authHeader }).success, false);
  assert.equal(providerSettingsSchema.safeParse({ apiKey: 'secret\r\nheader' }).success, false);
});

test('image request builders construct native Gemini, Grok and private Leonardo generation', () => {
  const gemini = buildImageRequest('gemini', 'Ceramic vase');
  assert.equal(gemini.path, '/models/gemini-3.1-flash-image:generateContent');
  assert.deepEqual(gemini.payload, { contents: [{ role: 'user', parts: [{ text: 'Ceramic vase' }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } });
  const grok = buildImageRequest('grok', 'Ceramic vase');
  assert.equal(grok.path, '/images/generations'); assert.deepEqual(grok.payload, { model: 'grok-imagine-image-2.0', prompt: 'Ceramic vase', n: 1, response_format: 'b64_json' });
  const leonardo = buildImageRequest('leonardo', 'Ceramic vase');
  assert.equal(leonardo.path, '/generations'); assert.equal(leonardo.payload.public, false); assert.equal(leonardo.payload.num_images, 1);
  for (const provider of ['gemini', 'grok', 'leonardo']) {
    const input = mediaInputSchema.parse({ provider, kind: 'image', prompt: 'Vase' });
    assert.equal(buildMediaRequest(input).model.length > 0, true);
    assert.throws(() => buildMediaRequest({ ...input, kind: 'audio' }), errorCode('unsupported_capability'));
    assert.throws(() => buildMediaRequest({ ...input, strength: 0.5 }), errorCode('unsupported_option'));
    assert.throws(() => buildMediaRequest({ ...input, sourceAssetId: 'owned' }, { name: 'source.png', mimeType: 'image/png', bytes: new ArrayBuffer(2) }), errorCode('unsupported_capability'));
  }
  assert.throws(() => buildImageRequest('gemini', 'Vase', '../private'), errorCode('invalid_model'));
  assert.throws(() => buildImageRequest('leonardo', 'Vase', 'not-a-uuid'), errorCode('invalid_model'));
});

test('image decoding uses actual bytes and rejects text-only, malformed and mismatched results', () => {
  // A local 1px image exercises decoding, not a simulated successful provider call.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  assert.equal(decodeImageResult({ data: [{ b64_json: png }] }, 'openai').mimeType, 'image/png');
  assert.equal(decodeImageResult({ candidates: [{ content: { parts: [{ text: 'Image follows' }, { inlineData: { data: png, mimeType: 'image/png' } }] } }] }, 'gemini').extension, 'png');
  assert.throws(() => decodeImageResult({ candidates: [{ content: { parts: [{ text: 'No image' }] } }] }, 'gemini'), errorCode('invalid_provider_response'));
  assert.throws(() => decodeImageResult({ data: [{ b64_json: 'invalid*!' }] }, 'openai'), errorCode('invalid_provider_response'));
  assert.throws(() => decodeImageResult({ data: [{ b64_json: btoa('<html>not an image</html>') }] }, 'openai'), errorCode('invalid_media_type'));
  assert.throws(() => decodeImageResult({ candidates: [{ content: { parts: [{ inlineData: { data: png, mimeType: 'image/jpeg' } }] } }] }, 'gemini'), errorCode('invalid_media_type'));
});

test('Leonardo polling parses terminal states and only permits its documented CDN', () => {
  assert.deepEqual(leonardoJob({ generations_by_pk: { status: 'PENDING', generated_images: [] } }), { status: 'processing' });
  for (const status of ['FAILED', 'UNKNOWN', undefined]) assert.throws(() => leonardoJob({ generations_by_pk: { status } }), errorCode('media_generation_failed'));
  for (const url of ['https://cdn.leonardo.ai.evil.test/image.jpg', 'http://cdn.leonardo.ai/image.jpg', 'https://user:pass@cdn.leonardo.ai/image.jpg', 'https://cdn.leonardo.ai:8443/image.jpg', 'https://127.0.0.1/image.jpg']) assert.throws(() => leonardoJob({ generations_by_pk: { status: 'COMPLETE', generated_images: [{ url }] } }), errorCode('invalid_media_url'));
  assert.equal(leonardoJob({ generations_by_pk: { status: 'COMPLETE', generated_images: [{ url: 'https://cdn.leonardo.ai/image.jpg' }] } }).url, 'https://cdn.leonardo.ai/image.jpg');
});

test('new model discovery uses official endpoints and response shapes', () => {
  assert.equal(modelDiscoveryRequest('deepseek', 'key').url, 'https://api.deepseek.com/models');
  assert.equal(modelDiscoveryRequest('leonardo', 'key').url, 'https://cloud.leonardo.ai/api/rest/v1/platformModels');
  assert.equal(modelDiscoveryRequest('grok', 'key').url, 'https://api.x.ai/v1/image-generation-models');
  assert.equal(parseModelPage('grok', { models: [{ id: 'grok-imagine-image-2.0' }] }).models[0].id, 'grok-imagine-image-2.0');
  assert.equal(parseModelPage('leonardo', { custom_models: [{ id: providerCatalog.leonardo.model, name: 'Phoenix' }] }).models[0].name, 'Phoenix');
  assert.throws(() => modelDiscoveryRequest('custom-team', 'secret'), errorCode('unsupported_provider'));
});

test('real HTTP redirects are rejected without forwarding authentication', async t => {
  let redirected = false;
  const server = createServer((request, response) => { if (request.url === '/redirect') { response.writeHead(302, { Location: '/target' }); response.end(); } else { redirected = true; response.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address() as { port: number };
  await assert.rejects(upstream(`http://127.0.0.1:${address.port}/redirect`, { headers: { Authorization: 'Bearer local-test' } }), errorCode('provider_error'));
  assert.equal(redirected, false);
});
