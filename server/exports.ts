import { publicCreativeProjection } from '../src/shared/public-creative-projection';
import { upgradeDocument } from '../src/shared/document-upgrade';
import type { InspectionRenderOptions } from '../src/shared/visual-inspection';

import {exportOptionsSchema as optionsSchema} from '../src/shared/export-contract';
import { createMotionArchive } from '../src/shared/motion-export';
import { frameExportBudget, frameExportBudgetMessage } from '../src/shared/frame-export-budget';
import { updateEvent } from './observability-store';
import { withSpan } from './observability';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import puppeteer from '@cloudflare/puppeteer';
import { documentSchema, type DesignDocument } from '../src/shared/schema';
import { renderSvg } from '../src/shared/render';
import { createReactArchive, type ReactRuntimeManifest } from '../src/shared/react-export';
import { documentFontFamilies, googleFontsStylesheetUrl } from '../src/shared/font-loading';
import type { Env, Bindings } from './types';
import { projectRow, validateAssets } from './projects';
import { ApiError, fail, origin, owner, rateLimit } from './security';
import { interactiveSnapshotHtml } from './published-html';

// Both adapters expose the small browser surface used here; the renderer itself is shared.
export interface ExportBrowser { newPage(): Promise<any>; close(): Promise<void> }
export const exportRoutes = new Hono<Env>();

const mimeTypes = {'scene-angles':'application/zip', motion:'application/zip', 'png-sequence':'application/zip', spritesheet:'application/zip', json: 'application/json', svg: 'image/svg+xml', html: 'text/html', png: 'image/png', pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', webm: 'video/webm', mp4: 'video/mp4', react: 'application/zip', glb: 'model/gltf-binary', gltf: 'model/gltf+json' };

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

exportRoutes.post('/:id/export', async c => renderProjectExport(c, c.req.param('id'), await c.req.json()));

export type SnapshotAssetResolver = (url: string) => Promise<{bytes: Uint8Array; mimeType: string}>;
export async function renderProjectExport(c: Context<Env>, projectId: string, input: unknown, thumbnail = false, snapshot?: Awaited<ReturnType<typeof projectRow>>, inspection?: InspectionRenderOptions) {
  return withSpan(c, {kind:'export',action:thumbnail?'thumbnail.render':'export.render'}, async span => {
    const owned = await projectRow(c, projectId), row = snapshot ?? owned, options = optionsSchema.parse(input);
    if (options.expectedRevision && options.expectedRevision !== row.revision) fail(409, 'revision_conflict', 'Save or reload the current revision before export.');
    span.event.projectId = row.id; span.event.action = thumbnail ? 'thumbnail.render' : `export.${options.format}`;
    await updateEvent(c.env, span.event);
    let doc = documentSchema.parse(JSON.parse(row.document));
    if (options.format !== 'json') { doc = publicCreativeProjection(upgradeDocument(doc)); await validateAssets(c, doc, row.id); }
    return renderSnapshotExport(c.env, row.name, doc, options, async url => {
      const asset = await c.env.DB.prepare('SELECT storage_key,mime_type FROM assets WHERE id=? AND user_id=?').bind(url.split('/').pop(), owner(c)).first<{storage_key:string;mime_type:string}>();
      if (!asset) fail(400, 'missing_asset', 'A referenced asset is unavailable.');
      const object = await c.env.ASSETS_BUCKET.get(asset.storage_key);
      if (!object) fail(400, 'missing_asset', 'An asset could not be loaded.');
      return {bytes:new Uint8Array(await object.arrayBuffer()),mimeType:asset.mime_type};
    }, {thumbnail, inspection, onBytes: outputBytes => span.set({outputBytes}), beforeRender: () => rateLimit(c, `${thumbnail?'thumbnail':'export'}:${owner(c)}`, thumbnail?60:20)});
  });
}

/** Render only a document and asset resolver already authorized by the calling service. */
export async function renderSnapshotExport(bindings: Bindings, name: string, document: DesignDocument, input: unknown, resolveAsset: SnapshotAssetResolver, hooks: {thumbnail?:boolean;inspection?:InspectionRenderOptions;thumbnailSelection?:{pageIndex:number;time:number;focalX:number;focalY:number};onBytes?:(bytes:number)=>void;beforeRender?:()=>Promise<void>} = {}) {
  const options=optionsSchema.parse(input), thumbnail=hooks.thumbnail ?? false;
  let doc=documentSchema.parse(structuredClone(document));
  if (!doc.pages[options.pageIndex]) fail(400, 'invalid_page', 'This page does not exist.');
  const frameEnd = options.end ?? doc.timeline?.duration ?? 2;
  if (!thumbnail && !hooks.inspection && (options.format === 'png-sequence' || options.format === 'spritesheet')) {
    const frameInput = {...doc.pages[options.pageIndex], start: options.start, end: frameEnd, fps: options.fps, format: options.format};
    if (!frameExportBudget(frameInput).withinLimits) fail(413, 'render_budget_exceeded', frameExportBudgetMessage(frameInput));
  }
  if (options.format === 'react' && !['web', 'wireframe'].includes(doc.kind)) fail(400, 'unsupported_export', 'React source export is available for Web/App and wireframe projects.');
  if (['glb', 'gltf'].includes(options.format) && doc.pages[options.pageIndex].nodes.some(node=>node.character)) fail(400,'unsupported_export','Character motion uses the native motion package; GLB/glTF cannot preserve 2D rigs.');
  if (['glb', 'gltf'].includes(options.format) && !doc.pages[options.pageIndex].nodes.some(node => node.type === 'model3d')) fail(400, 'unsupported_export', 'Scene export requires a 3D object on the selected page.');
  const extension = ['react','motion','png-sequence','spritesheet','scene-angles'].includes(options.format) ? 'zip' : options.format;
  const headers = { 'Content-Type': mimeTypes[options.format], 'Content-Disposition': `attachment; filename="${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.${extension}"`, 'Cache-Control': 'private,no-store', 'X-Content-Type-Options': 'nosniff' };
  if (options.format === 'json') { const output = JSON.stringify(doc, null, 2); hooks.onBytes?.(new TextEncoder().encode(output).length); return new Response(output, { headers }); }
  if (!['html', 'svg', 'react'].includes(options.format)) {
    const selectedPages = hooks.inspection ? hooks.inspection.pageIndices.map(index => doc.pages[index]) : options.format === 'pdf' || options.format === 'pptx' ? doc.pages : [doc.pages[options.pageIndex]];
    const renderNodes = selectedPages.flatMap(page => page.nodes.filter(node => node.visible !== false));
    const totalPixels = selectedPages.reduce((sum, page) => sum + page.width * page.height, 0) + renderNodes.filter(node => node.type === 'model3d').reduce((sum, node) => sum + node.width * node.height, 0);
    if (renderNodes.some(node => node.width * node.height > 16777216) || totalPixels > 67108864) fail(413, 'render_budget_exceeded', 'Reduce page or object dimensions; a render may contain at most 64 megapixels in total and 16 megapixels per object.');
    const characterMedia=doc.characters?.flatMap(c=>c.attachments.flatMap(a=>[a.assetId,...(a.frames??[])])).filter(Boolean)??[];
    const characterUrls=doc.assets.filter(a=>characterMedia.includes(a.id)).map(a=>a.url);
    const media = renderNodes.flatMap(node => [node.src, doc.assets.find(asset => asset.id === node.scene?.material?.textureAssetId)?.url]);
    if ([...media,...characterUrls].some(url => url && !url.startsWith('/api/assets/') && !url.startsWith('/api/community/') && !url.startsWith('data:'))) fail(400, 'import_asset_required', 'Import external media into the project before cloud rendering. Cloud renderers have no external network access.');
  }
  let embeddedSize = 0;
  const embedded = new Map<string, string>();
  const embed = async (url: string): Promise<string> => {
    if (!url.startsWith('/api/assets/') && !url.startsWith('/api/community/')) return url;
    if (embedded.has(url)) return embedded.get(url)!;
    const asset = await resolveAsset(url);
    embeddedSize += asset.bytes.byteLength;
    if (embeddedSize > 30 * 1024 * 1024) fail(413, 'export_too_large', 'Embedded media exceeds 30 MB; reduce the export assets.');
    const result = `data:${asset.mimeType};base64,${Buffer.from(asset.bytes).toString('base64')}`;
    embedded.set(url, result);
    return result;
  };
  for (const page of doc.pages) for (const node of page.nodes) if (node.src) node.src = await embed(node.src);
  for (const asset of doc.assets) asset.url = await embed(asset.url);
  if (options.format === 'svg') { const output = renderSvg(doc, options.pageIndex); hooks.onBytes?.(new TextEncoder().encode(output).length); return new Response(output, { headers }); }
  if (options.format === 'html') { const output = await interactiveSnapshotHtml(bindings, doc); hooks.onBytes?.(new TextEncoder().encode(output).length); return new Response(output, { headers }); }
  if (options.format === 'motion') {
    const runtime=await bindings.ASSETS?.fetch(new Request(`${(bindings.APP_URL ?? 'http://localhost')}/studio-viewer.js`));if(!runtime?.ok)fail(503,'renderer_not_built','Build the viewer before exporting.');
    if(doc.assets.some(a=>!a.url.startsWith('data:')))fail(400,'import_asset_required','Import all assets before portable export.');
    const output=await createMotionArchive(doc,await runtime.text());hooks.onBytes?.(output.byteLength);return new Response(new Uint8Array(output).buffer,{headers});
  }
  if (options.format === 'react') {
    await hooks.beforeRender?.();
    const runtime = await bindings.ASSETS?.fetch(new Request(`${(bindings.APP_URL ?? 'http://localhost')}/studio-react-runtime.json`));
    if (!runtime?.ok) fail(503, 'renderer_not_built', 'Build the React runtime manifest before exporting.');
    const output = await createReactArchive(doc, await runtime.json() as ReactRuntimeManifest);
    hooks.onBytes?.(output.byteLength);
    return new Response(new Uint8Array(output).buffer, { headers });
  }
  if (!bindings.BROWSER && !bindings.EXPORT_BROWSER) fail(503, 'renderer_not_configured', 'Enable the Cloudflare Browser Rendering binding or install Chromium for self-hosting.');
  if (doc.pages.some(p => p.width * p.height > 16777216)) fail(413, 'canvas_too_large', 'Render exports support up to 16 megapixels per page.');
  await hooks.beforeRender?.();
  const fonts = ['png', 'pdf', 'pptx', 'webm', 'mp4','png-sequence','spritesheet'].includes(options.format) ? await embeddedDocumentFonts(doc) : null;
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
    const bundle = await bindings.ASSETS?.fetch(new Request(`${(bindings.APP_URL ?? 'http://localhost')}/studio-renderer.js`));
    if (!bundle?.ok) fail(503, 'renderer_not_built', 'Build the renderer bundle before exporting.');
    await page.addScriptTag({ content: await bundle.text() });
    let output: Uint8Array;
    if (hooks.inspection) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const encoded = await Promise.race([
          page.evaluate(({ doc, inspection }: any) => (globalThis as any).studioRenderer.inspectVisual(doc, inspection), { doc, inspection: hooks.inspection }),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Visual inspection timed out')), 45000); }),
        ]);
        if (encoded.length > 12 * 1024 * 1024) fail(413, 'inspection_too_large', 'Reduce inspection dimensions or page count.');
        output = Buffer.from(encoded, 'base64');
      } finally { if (timeout) clearTimeout(timeout); }
    } else if (thumbnail) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const encoded = await Promise.race([
          page.evaluate(({doc,selection}:any) => (globalThis as any).studioRenderer.thumbnail(doc,selection), {doc,selection:hooks.thumbnailSelection}),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Thumbnail render timed out')), 45000); }),
        ]);
        output = Buffer.from(encoded, 'base64');
      } finally { if (timeout) clearTimeout(timeout); }
    } else if(options.format==='scene-angles'){
      if(current.width*current.height*4>67108864)fail(413,'render_budget_exceeded','Four views exceed 64 megapixels');
      const encoded=await page.evaluate(({doc,index,time}:any)=>(globalThis as any).studioRenderer.sceneAngles(doc,index,time),{doc,index:options.pageIndex,time:options.start});output=Buffer.from(encoded,'base64');
    } else if(['png-sequence','spritesheet'].includes(options.format)){
      const end=frameEnd;
      const encoded=await page.evaluate(({doc,index,format,start,end,fps}:any)=>(globalThis as any).studioRenderer.motionFrames(doc,index,format,start,end,fps),{doc,index:options.pageIndex,format:options.format,start:options.start,end,fps:options.fps});output=Buffer.from(encoded,'base64');
    } else if (['pptx', 'webm', 'mp4', 'glb', 'gltf'].includes(options.format)) {
      const encoded = await page.evaluate(async ({ document, pageIndex, format, videoOptions }: { document: DesignDocument; pageIndex: number; format: string; videoOptions:{start:number;end?:number;fps:number} }) => {
        const renderer = (globalThis as any).studioRenderer;
        return format === 'pptx' ? renderer.pptx(document) : format === 'glb' || format === 'gltf' ? renderer.scene(document, pageIndex, format) : renderer.video(document, pageIndex, format,videoOptions);
      }, { document: doc, pageIndex: options.pageIndex, format: options.format,videoOptions:{start:options.start,end:options.end,fps:options.fps} });
      output = Buffer.from(encoded, 'base64');
    } else {
      await page.evaluate(({ document, pageIndex, all }: { document: DesignDocument; pageIndex: number; all: boolean }) => (globalThis as any).studioRenderer.present(document, pageIndex, all), { document: doc, pageIndex: options.pageIndex, all: options.format === 'pdf' });
      output = options.format === 'png' ? await page.screenshot({ type: 'png' }) : await page.pdf({ printBackground: true, preferCSSPageSize: true });
    }
    if (output.byteLength < 32) fail(502, 'empty_render', 'The renderer produced no usable file. Retry the export.');
    hooks.onBytes?.(output.byteLength);
    return new Response(new Uint8Array(output).buffer, { headers });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Browser errors can include URLs. Avoid leaking provider/asset credentials.
    fail(502, 'render_failed', 'Cloud rendering failed. Check that media files decode and external assets permit cross-origin access; try PNG or WebM.');
  } finally { await browser?.close(); }
}
