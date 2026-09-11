import { updateEvent } from './observability-store';
import { withSpan } from './observability';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import puppeteer from '@cloudflare/puppeteer';
import { documentSchema, type DesignDocument } from '../src/shared/schema';
import { renderSvg } from '../src/shared/render';
import { createReactArchive, type ReactRuntimeManifest } from '../src/shared/react-export';
import { documentFontFamilies, googleFontsStylesheetUrl } from '../src/shared/font-loading';
import type { Env } from './types';
import { projectRow, validateAssets } from './projects';
import { ApiError, fail, origin, owner, rateLimit } from './security';
import { interactiveHtml } from './published-html';

// Both adapters expose the small browser surface used here; the renderer itself is shared.
export interface ExportBrowser { newPage(): Promise<any>; close(): Promise<void> }
export const exportRoutes = new Hono<Env>();
const optionsSchema = z.object({ format: z.enum(['json', 'svg', 'html', 'png', 'pdf', 'pptx', 'webm', 'mp4', 'react', 'glb', 'gltf']), pageIndex: z.number().int().min(0).default(0), expectedRevision: z.number().int().positive().optional() });
const mimeTypes = { json: 'application/json', svg: 'image/svg+xml', html: 'text/html', png: 'image/png', pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', webm: 'video/webm', mp4: 'video/mp4', react: 'application/zip', glb: 'model/gltf-binary', gltf: 'model/gltf+json' };

/** Fetch only generated Google Fonts CSS and its fixed-origin font files, before browser isolation. */
export async function embeddedDocumentFonts(doc: DesignDocument) {
  const url = googleFontsStylesheetUrl(documentFontFamilies(doc));
  if (!url) return null;
  let totalBytes = 0;
  const signal = AbortSignal.timeout(15000);
  const read = async (address: string, limit: number) => {
    const response = await fetch(address, { redirect: 'manual', signal, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36' } });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Font response unavailable.'); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; totalBytes += value.byteLength;
        if (size > limit || totalBytes > 10 * 1024 * 1024) throw new Error('Font byte limit exceeded.');
        chunks.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    return Buffer.concat(chunks);
  };
  try {
    let css = (await read(url, 128 * 1024)).toString('utf8');
    if (/@import\b/i.test(css)) throw new Error('Unexpected stylesheet import.');
    const matches = [...css.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g)];
    const files = new Map<string, string>();
    for (const match of matches) {
      const address = new URL(match[2]);
      if (address.origin !== 'https://fonts.gstatic.com' || address.username || address.password || !/\.(woff2?|ttf|otf)$/.test(address.pathname)) throw new Error('Unexpected font source.');
      if (!files.has(address.href)) {
        if (files.size >= 128) throw new Error('Font file limit exceeded.');
        const bytes = await read(address.href, 2 * 1024 * 1024);
        const type = address.pathname.endsWith('.woff2') ? 'woff2' : address.pathname.endsWith('.woff') ? 'woff' : address.pathname.endsWith('.ttf') ? 'ttf' : 'otf';
        files.set(address.href, `data:font/${type};base64,${bytes.toString('base64')}`);
      }
      css = css.replace(match[0], `url('${files.get(address.href)}')`);
    }
    if (!matches.length || /url\(/i.test(css.replace(/url\('data:[^']+'\)/g, ''))) throw new Error('Missing or unsupported font source.');
    return { url, css };
  } catch { fail(502, 'font_load_failed', 'The selected Google Fonts could not be loaded. Choose a local font or retry the export.'); }
}

export async function renderProjectExport(c:Context<Env>,projectId:string,input:unknown){
  return withSpan(c, { kind: 'export', action: 'export.render' }, async span => {
  const { env: bindings } = c;
  const row = await projectRow(c, projectId), options = optionsSchema.parse(input);
  if (options.expectedRevision && options.expectedRevision !== row.revision) fail(409, 'revision_conflict', 'Save or reload the current revision before export.');
  span.event.projectId = row.id; span.event.action = `export.${options.format}`;
  await updateEvent(c.env, span.event);
  const doc = documentSchema.parse(JSON.parse(row.document));
  if (!doc.pages[options.pageIndex]) fail(400, 'invalid_page', 'This page does not exist.');
  if (options.format === 'react' && !['web', 'wireframe'].includes(doc.kind)) fail(400, 'unsupported_export', 'React source export is available for Web/App and wireframe projects.');
  if (['glb', 'gltf'].includes(options.format) && !doc.pages[options.pageIndex].nodes.some(node => node.type === 'model3d')) fail(400, 'unsupported_export', 'Scene export requires a 3D object on the selected page.');
  const extension = options.format === 'react' ? 'zip' : options.format;
  const headers = { 'Content-Type': mimeTypes[options.format], 'Content-Disposition': `attachment; filename="${row.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.${extension}"`, 'Cache-Control': 'private,no-store', 'X-Content-Type-Options': 'nosniff' };
  if (options.format === 'json') { const output = JSON.stringify(doc, null, 2); span.set({ outputBytes: new TextEncoder().encode(output).length }); return new Response(output, { headers }); }
  await validateAssets(c, doc, row.id);
  if (!['html', 'svg', 'react'].includes(options.format)) {
    const selectedPages = options.format === 'pdf' || options.format === 'pptx' ? doc.pages : [doc.pages[options.pageIndex]];
    const renderNodes = selectedPages.flatMap(page => page.nodes.filter(node => node.visible !== false));
    const totalPixels = selectedPages.reduce((sum, page) => sum + page.width * page.height, 0) + renderNodes.filter(node => node.type === 'model3d').reduce((sum, node) => sum + node.width * node.height, 0);
    if (renderNodes.some(node => node.width * node.height > 16777216) || totalPixels > 67108864) fail(413, 'render_budget_exceeded', 'Reduce page or object dimensions; a render may contain at most 64 megapixels in total and 16 megapixels per object.');
    const media = renderNodes.flatMap(node => [node.src, doc.assets.find(asset => asset.id === node.scene?.material?.textureAssetId)?.url]);
    if (media.some(url => url && !url.startsWith('/api/assets/') && !url.startsWith('data:'))) fail(400, 'import_asset_required', 'Import external media into the project before cloud rendering. Cloud renderers have no external network access.');
  }
  let embeddedSize = 0;
  const embedded = new Map<string, string>();
  const embed = async (url: string): Promise<string> => {
    if (!url.startsWith('/api/assets/')) return url;
    if (embedded.has(url)) return embedded.get(url)!;
    const asset = await bindings.DB.prepare('SELECT storage_key,mime_type FROM assets WHERE id=? AND user_id=?').bind(url.split('/').pop(), owner(c)).first<{ storage_key: string; mime_type: string }>();
    if (!asset) fail(400, 'missing_asset', 'A referenced asset is unavailable.');
    const object = await bindings.ASSETS_BUCKET.get(asset.storage_key); if (!object) fail(400, 'missing_asset', 'An asset could not be loaded.');
    const bytes = await object.arrayBuffer(); embeddedSize += bytes.byteLength;
    if (embeddedSize > 30 * 1024 * 1024) fail(413, 'export_too_large', 'Embedded media exceeds 30 MB; reduce the export assets.');
    const result = `data:${asset.mime_type};base64,${Buffer.from(bytes).toString('base64')}`;
    embedded.set(url, result);
    return result;
  };
  for (const page of doc.pages) for (const node of page.nodes) if (node.src) node.src = await embed(node.src);
  for (const asset of doc.assets) asset.url = await embed(asset.url);
  if (options.format === 'svg') { const output = renderSvg(doc, options.pageIndex); span.set({ outputBytes: new TextEncoder().encode(output).length }); return new Response(output, { headers }); }
  if (options.format === 'html') { const output = await interactiveHtml(c, doc); span.set({ outputBytes: new TextEncoder().encode(output).length }); return new Response(output, { headers }); }
  if (options.format === 'react') {
    await rateLimit(c, `export:${owner(c)}`, 20);
    const runtime = await bindings.ASSETS?.fetch(new Request(`${origin(c)}/studio-react-runtime.json`));
    if (!runtime?.ok) fail(503, 'renderer_not_built', 'Build the React runtime manifest before exporting.');
    const output = await createReactArchive(doc, await runtime.json() as ReactRuntimeManifest);
    span.set({ outputBytes: output.byteLength });
    return new Response(new Uint8Array(output).buffer, { headers });
  }
  if (!bindings.BROWSER && !bindings.EXPORT_BROWSER) fail(503, 'renderer_not_configured', 'Enable the Cloudflare Browser Rendering binding or install Chromium for self-hosting.');
  if (doc.pages.some(p => p.width * p.height > 16777216)) fail(413, 'canvas_too_large', 'Render exports support up to 16 megapixels per page.');
  await rateLimit(c, `export:${owner(c)}`, 20);
  const fonts = ['png', 'pdf', 'pptx', 'webm', 'mp4'].includes(options.format) ? await embeddedDocumentFonts(doc) : null;
  let browser: ExportBrowser | undefined;
  try {
    browser = bindings.EXPORT_BROWSER ? await bindings.EXPORT_BROWSER() : await puppeteer.launch(bindings.BROWSER!);
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
    if (fonts) {
      const style = await page.addStyleTag({ content: fonts.css });
      await style.evaluate((element: HTMLElement, url: string) => element.setAttribute('data-studio-fonts-embedded', url), fonts.url);
    }
    const bundle = await bindings.ASSETS?.fetch(new Request(`${origin(c)}/studio-renderer.js`));
    if (!bundle?.ok) fail(503, 'renderer_not_built', 'Build the renderer bundle before exporting.');
    await page.addScriptTag({ content: await bundle.text() });
    let output: Uint8Array;
    if (['pptx', 'webm', 'mp4', 'glb', 'gltf'].includes(options.format)) {
      const encoded = await page.evaluate(async ({ document, pageIndex, format }: { document: DesignDocument; pageIndex: number; format: string }) => {
        const renderer = (globalThis as any).studioRenderer;
        return format === 'pptx' ? renderer.pptx(document) : format === 'glb' || format === 'gltf' ? renderer.scene(document, pageIndex, format) : renderer.video(document, pageIndex, format);
      }, { document: doc, pageIndex: options.pageIndex, format: options.format });
      output = Buffer.from(encoded, 'base64');
    } else {
      await page.evaluate(({ document, pageIndex, all }: { document: DesignDocument; pageIndex: number; all: boolean }) => (globalThis as any).studioRenderer.present(document, pageIndex, all), { document: doc, pageIndex: options.pageIndex, all: options.format === 'pdf' });
      output = options.format === 'png' ? await page.screenshot({ type: 'png' }) : await page.pdf({ printBackground: true, preferCSSPageSize: true });
    }
    if (output.byteLength < 32) fail(502, 'empty_render', 'The renderer produced no usable file. Retry the export.');
    span.set({ outputBytes: output.byteLength });
    return new Response(new Uint8Array(output).buffer, { headers });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Browser errors can include URLs. Avoid leaking provider/asset credentials.
    fail(502, 'render_failed', 'Cloud rendering failed. Check that media files decode and external assets permit cross-origin access; try PNG or WebM.');
  } finally { await browser?.close(); }
});
}
exportRoutes.post('/:id/export',async c=>renderProjectExport(c,c.req.param('id'),await c.req.json()));
