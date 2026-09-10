import { providerHeaders } from './provider-connections';
import { fail } from './security';
import type { AuthMethod, ProviderProtocol } from '../src/shared/providers';

export function buildTextRequest(config: { provider: string; protocol: ProviderProtocol; base_url: string; key: string; authMethod: AuthMethod; authHeader?: string }, body: { model: string; system: string; prompt: string; maxTokens?: number }) {
  const { model, system, prompt, maxTokens } = body;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...providerHeaders(config) };
  let path: string, payload: Record<string, unknown>;
  if (config.protocol === 'anthropic') {
    path = '/messages'; headers['anthropic-version'] = '2023-06-01';
    payload = { model, max_tokens: maxTokens ?? 16000, system, messages: [{ role: 'user', content: prompt }] };
  } else if (config.protocol === 'gemini') {
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) fail(400, 'invalid_model', 'Invalid Gemini model.');
    path = `/models/${model}:generateContent`;
    payload = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', ...(maxTokens ? { maxOutputTokens: maxTokens } : {}) } };
  } else {
    path = '/chat/completions';
    payload = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], response_format: { type: 'json_object' }, ...(maxTokens ? { max_tokens: maxTokens } : {}) };
  }
  return { url: `${config.base_url}${path}`, init: { method: 'POST', headers, body: JSON.stringify(payload) } };
}
