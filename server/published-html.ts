import type { Context } from 'hono';
import type { Env, Bindings } from './types';
import type { DesignDocument } from '../src/shared/schema';
import { renderHtml } from '../src/shared/render';
import { fail, origin } from './security';

export async function interactiveHtml(c: Context<Env>, doc: DesignDocument, nonce?: string) {
  return interactiveSnapshotHtml(c.env, doc, nonce, origin(c));
}

export async function interactiveSnapshotHtml(env: Bindings, doc: DesignDocument, nonce?: string, base = env.APP_URL ?? 'http://localhost') {
  if (doc.kind !== 'slides' && !doc.timeline && !doc.pages.some(page => page.layout || page.nodes.some(node => node.layout || node.component || ['model3d','character'].includes(node.type) && node.visible !== false))) return renderHtml(doc);
  const response = await env.ASSETS?.fetch(new Request(`${base}/studio-viewer.js`));
  if (!response?.ok) fail(503, 'viewer_not_built', 'Build the viewer bundle before publishing or exporting interactive designs.');
  return renderHtml(doc, { script: await response.text(), nonce });
}
