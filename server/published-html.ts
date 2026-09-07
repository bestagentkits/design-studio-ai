import type { Context } from 'hono';
import type { Env } from './types';
import type { DesignDocument } from '../src/shared/schema';
import { renderHtml } from '../src/shared/render';
import { fail, origin } from './security';

export async function interactiveHtml(c: Context<Env>, doc: DesignDocument, nonce?: string) {
  if (!doc.timeline && !doc.pages.some(page => page.nodes.some(node => node.type === 'model3d' && node.visible !== false))) return renderHtml(doc);
  const response = await c.env.ASSETS?.fetch(new Request(`${origin(c)}/studio-viewer.js`));
  if (!response?.ok) fail(503, 'viewer_not_built', 'Build the viewer bundle before publishing or exporting interactive designs.');
  return renderHtml(doc, { script: await response.text(), nonce });
}
