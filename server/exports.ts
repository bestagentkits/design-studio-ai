import { Hono } from 'hono';
import { z } from 'zod';
import puppeteer from '@cloudflare/puppeteer';
import { documentSchema, type DesignDocument } from '../src/shared/schema';
import { renderHtml, renderSvg } from '../src/shared/render';
import type { Env } from './types';
import { projectRow, validateAssets } from './projects';
import { ApiError, fail, origin, owner, rateLimit } from './security';
import { interactiveHtml } from './published-html';

// Both adapters expose the small browser surface used here; the renderer itself is shared.
export interface ExportBrowser { newPage(): Promise<any>; close(): Promise<void> }
export const exportRoutes = new Hono<Env>();
const optionsSchema = z.object({ format: z.enum(['json', 'svg', 'html', 'png', 'pdf', 'pptx', 'webm', 'mp4']), pageIndex: z.number().int().min(0).default(0), expectedRevision: z.number().int().positive().optional() });
const mimeTypes = { json: 'application/json', svg: 'image/svg+xml', html: 'text/html', png: 'image/png', pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', webm: 'video/webm', mp4: 'video/mp4' };

exportRoutes.post('/:id/export', async c => {
  const row = await projectRow(c, c.req.param('id')), options = optionsSchema.parse(await c.req.json());
  if (options.expectedRevision && options.expectedRevision !== row.revision) fail(409, 'revision_conflict', 'Save or reload the current revision before export.');
  const doc = documentSchema.parse(JSON.parse(row.document));
  if (!doc.pages[options.pageIndex]) fail(400, 'invalid_page', 'This page does not exist.');
  const headers = { 'Content-Type': mimeTypes[options.format], 'Content-Disposition': `attachment; filename="${row.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.${options.format}"`, 'Cache-Control': 'private,no-store', 'X-Content-Type-Options': 'nosniff' };
  if (options.format === 'json') return new Response(JSON.stringify(doc, null, 2), { headers });
  await validateAssets(c, doc, row.id);
  if (!['html', 'svg'].includes(options.format)) {
    const selectedPages = options.format === 'pdf' || options.format === 'pptx' ? doc.pages : [doc.pages[options.pageIndex]];
    const renderNodes = selectedPages.flatMap(page => page.nodes.filter(node => node.visible !== false));
    const totalPixels = selectedPages.reduce((sum, page) => sum + page.width * page.height, 0) + renderNodes.filter(node => node.type === 'model3d').reduce((sum, node) => sum + node.width * node.height, 0);
    if (renderNodes.some(node => node.width * node.height > 16777216) || totalPixels > 67108864) fail(413, 'render_budget_exceeded', 'Reduce page or object dimensions; a render may contain at most 64 megapixels in total and 16 megapixels per object.');
    if (renderNodes.some(node => node.src && !node.src.startsWith('/api/assets/') && !node.src.startsWith('data:'))) fail(400, 'import_asset_required', 'Import external media into the project before cloud rendering. Cloud renderers have no external network access.');
  }
  let embeddedSize = 0;
  for (const page of doc.pages) for (const node of page.nodes) {
    if (!node.src?.startsWith('/api/assets/')) continue;
    const asset = await c.env.DB.prepare('SELECT storage_key,mime_type FROM assets WHERE id=? AND user_id=?').bind(node.src.split('/').pop(), owner(c)).first<{ storage_key: string; mime_type: string }>();
    if (!asset) fail(400, 'missing_asset', 'A referenced asset is unavailable.');
    const object = await c.env.ASSETS_BUCKET.get(asset.storage_key); if (!object) fail(400, 'missing_asset', 'An asset could not be loaded.');
    const bytes = await object.arrayBuffer(); embeddedSize += bytes.byteLength;
    if (embeddedSize > 30 * 1024 * 1024) fail(413, 'export_too_large', 'Embedded media exceeds 30 MB; reduce the export assets.');
    node.src = `data:${asset.mime_type};base64,${Buffer.from(bytes).toString('base64')}`;
  }
  if (options.format === 'svg') return new Response(renderSvg(doc, options.pageIndex), { headers });
  if (options.format === 'html') return new Response(await interactiveHtml(c, doc), { headers });
  if (!c.env.BROWSER && !c.env.EXPORT_BROWSER) fail(503, 'renderer_not_configured', 'Enable the Cloudflare Browser Rendering binding or install Chromium for self-hosting.');
  if (doc.pages.some(p => p.width * p.height > 16777216)) fail(413, 'canvas_too_large', 'Render exports support up to 16 megapixels per page.');
  await rateLimit(c, `export:${owner(c)}`, 20);
  let browser: ExportBrowser | undefined;
  try {
    browser = c.env.EXPORT_BROWSER ? await c.env.EXPORT_BROWSER() : await puppeteer.launch(c.env.BROWSER!);
    const page = await browser.newPage();
    // Never expose the renderer's network to imported GLB texture/buffer references or redirects.
    if (page.route) await page.route('**/*', (route: any) => /^(data:|blob:|about:)/.test(route.request().url()) ? route.continue() : route.abort());
    else {
      await page.setRequestInterception(true);
      page.on('request', (request: any) => /^(data:|blob:|about:)/.test(request.url()) ? request.continue() : request.abort());
    }
    const current = doc.pages[options.pageIndex];
    if (page.setViewport) await page.setViewport({ width: Math.ceil(current.width), height: Math.ceil(current.height), deviceScaleFactor: 1 });
    else await page.setViewportSize({ width: Math.ceil(current.width), height: Math.ceil(current.height) });
    // Imported designs never supply scripts. Only our bundled renderer executes in this isolated browser.
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    const bundle = await c.env.ASSETS?.fetch(new Request(`${origin(c)}/studio-renderer.js`));
    if (!bundle?.ok) fail(503, 'renderer_not_built', 'Build the renderer bundle before exporting.');
    await page.addScriptTag({ content: await bundle.text() });
    let output: Uint8Array;
    if (options.format === 'pptx' || options.format === 'webm' || options.format === 'mp4') {
      const encoded = await page.evaluate(async ({ document, pageIndex, format }: { document: DesignDocument; pageIndex: number; format: string }) => {
        const renderer = (globalThis as any).studioRenderer;
        return format === 'pptx' ? renderer.pptx(document) : renderer.video(document, pageIndex, format);
      }, { document: doc, pageIndex: options.pageIndex, format: options.format });
      output = Buffer.from(encoded, 'base64');
    } else {
      await page.evaluate(({ document, pageIndex, all }: { document: DesignDocument; pageIndex: number; all: boolean }) => (globalThis as any).studioRenderer.present(document, pageIndex, all), { document: doc, pageIndex: options.pageIndex, all: options.format === 'pdf' });
      output = options.format === 'png' ? await page.screenshot({ type: 'png' }) : await page.pdf({ printBackground: true, preferCSSPageSize: true });
    }
    if (output.byteLength < 32) fail(502, 'empty_render', 'The renderer produced no usable file. Retry the export.');
    return new Response(new Uint8Array(output).buffer, { headers });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Browser errors can include URLs. Avoid leaking provider/asset credentials.
    fail(502, 'render_failed', 'Cloud rendering failed. Check that media files decode and external assets permit cross-origin access; try PNG or WebM.');
  } finally { await browser?.close(); }
});
