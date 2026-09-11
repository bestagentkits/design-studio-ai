import { z } from 'zod';
import { boundedConnectorJson, type ConnectorJson } from '../../src/shared/connector-values';
import { fail } from '../security';

export type McpSafeContent = { type: 'text'; text: string } | { type: 'image' | 'audio' | 'binary'; mimeType: string; data: string }
  | { type: 'resource_link'; uri: string; name: string; mimeType?: string } | { type: 'resource'; uri: string; content: McpSafeContent };
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const audioTypes = new Set(['audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/flac']);
const text = z.string().max(262144);
const uri = z.string().min(1).max(2048).refine(value => !/[\u0000-\u001f]/.test(value) && !/^(javascript|data|vbscript|blob):/i.test(value));
function binary(type: 'image' | 'audio' | 'binary', data: unknown, mimeType: unknown): McpSafeContent {
  const mime = z.string().max(120).parse(mimeType), value = z.string().max(524288).parse(data);
  const allowed = type === 'image' ? imageTypes.has(mime) : type === 'audio' ? audioTypes.has(mime) : mime === 'application/pdf' || mime === 'application/octet-stream' || imageTypes.has(mime) || audioTypes.has(mime);
  if (!allowed || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail(422, 'unsupported_content', 'Unsupported remote media content.');
  return { type, mimeType: mime, data: value };
}
/** Returned text, URIs and structured values are inert untrusted data, never HTML or fetch instructions. */
export function decodeMcpContent(input: unknown): { content: McpSafeContent[]; structuredContent?: ConnectorJson } {
  const bounded = boundedConnectorJson(1048576).parse(input);
  const value = z.object({ isError: z.boolean().optional(), content: z.array(z.unknown()).max(100).default([]), structuredContent: z.unknown().optional() }).parse(bounded);
  if (value.isError) fail(502, 'remote_tool_error', 'The remote tool reported a failure.');
  const content = value.content.map((input): McpSafeContent => {
    const item = z.record(z.string(), z.unknown()).parse(input);
    if (item.type === 'text') return { type: 'text', text: text.parse(item.text) };
    if (item.type === 'image' || item.type === 'audio') return binary(item.type, item.data, item.mimeType);
    if (item.type === 'resource_link') return { type: 'resource_link', uri: uri.parse(item.uri), name: z.string().max(200).parse(item.name), ...(item.mimeType ? { mimeType: z.string().max(120).parse(item.mimeType) } : {}) };
    if (item.type === 'resource') {
      const resource = z.record(z.string(), z.unknown()).parse(item.resource);
      return { type: 'resource', uri: uri.parse(resource.uri), content: typeof resource.text === 'string' ? { type: 'text', text: text.parse(resource.text) } : binary('binary', resource.blob, resource.mimeType) };
    }
    return fail(422, 'unsupported_content', 'Unsupported remote content type.');
  });
  return { content, ...(value.structuredContent === undefined ? {} : { structuredContent: boundedConnectorJson(262144).parse(value.structuredContent) }) };
}

export function decodeMcpResourceContents(input: unknown) {
  const value = z.object({ contents: z.array(z.unknown()).max(100) }).parse(boundedConnectorJson(1048576).parse(input));
  return decodeMcpContent({ content: value.contents.map(resource => ({ type: 'resource', resource })) });
}
