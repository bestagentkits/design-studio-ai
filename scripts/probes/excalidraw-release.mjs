// Pinned release probe. Downloads only into scratch; does not alter repository dependencies.
import { mkdtemp, readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const scratch = process.argv[2] || await mkdtemp(join(tmpdir(), 'dsa-excalidraw-'));
await mkdir(scratch, { recursive: true });
const version = '0.18.1';
const expectedIntegrity = 'sha512-6i5Gt7IDTOH//qa0Z315Ly5iVRhjWpu2whrlQFqkuwrkKUWgRsMk0P5qdE7bpyDpai7jeLeWYkyj1eVAfni1lw==';
const run = (args) => execFileSync('npm', args, { cwd: scratch, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
run(['pack', `@excalidraw/excalidraw@${version}`, '--silent']);
const archive = await readFile(join(scratch, `excalidraw-excalidraw-${version}.tgz`));
assert.equal(`sha512-${createHash('sha512').update(archive).digest('base64')}`, expectedIntegrity);
await writeFile(join(scratch, 'package.json'), '{"private":true,"type":"module"}');
run(['install', '--ignore-scripts', '--no-audit', '--no-fund', join(scratch, `excalidraw-excalidraw-${version}.tgz`), 'react@19.2.8', 'react-dom@19.2.8']);
const pkgRoot = join(scratch, 'node_modules/@excalidraw/excalidraw');
const pkg = JSON.parse(await readFile(join(pkgRoot, 'package.json'), 'utf8'));
const types = await readFile(join(pkgRoot, 'dist/types/excalidraw/types.d.ts'), 'utf8');
const elementTypes = await readFile(join(pkgRoot, 'dist/types/excalidraw/element/types.d.ts'), 'utf8');
const evidence = {};
for (const name of (await readdir(join(pkgRoot, 'dist/dev'), { recursive: true })).filter(n => n.endsWith('.map'))) {
  const map = JSON.parse(await readFile(join(pkgRoot, 'dist/dev', name), 'utf8'));
  map.sources?.forEach((source, i) => {
    if (/(data\/restore\.ts|renderer\/renderElement\.ts|components\/App\.tsx)$/.test(source)) {
      evidence[source] = { sha256: createHash('sha256').update(map.sourcesContent[i]).digest('hex') };
    }
  });
}
const entry = join(scratch, 'entry.js');
await writeFile(entry, `import React from 'react';
import {createRoot} from 'react-dom/client';
import * as E from '@excalidraw/excalidraw';
window.E=E;
window.changes=[];
createRoot(document.getElementById('root')).render(React.createElement(E.Excalidraw,{
  excalidrawAPI: api => window.api=api,
  onChange: elements => window.changes.push(elements.map(e=>({id:e.id,x:e.x}))),
  initialData:{elements:[],appState:{viewBackgroundColor:'#ffffff'}},
}));`);
await build({ entryPoints: [entry], bundle: true, outfile: join(scratch, 'probe.js'), format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.woff2': 'dataurl' }, logLevel: 'warning' });
const browser = await chromium.launch({ headless: true });
let runtime;
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.route('**/*', route => route.abort());
  await page.setContent('<div id="root" style="width:1000px;height:800px"></div>');
  await page.addStyleTag({ path: join(pkgRoot, 'dist/prod/index.css') });
  await page.addScriptTag({ path: join(scratch, 'probe.js') });
  await page.waitForFunction(() => window.api);
  runtime = await page.evaluate(async () => {
    const E=window.E, api=window.api;
    const base={id:'curve',type:'line',x:10,y:20,width:100,height:100,points:[[0,0],[100,100]],roughness:0,seed:7};
    const path={...base,type:'path',commands:[['M',0,0],['C',0,100,100,0,100,100]]};
    const unknown=E.restoreElements([path],null);
    const pressure=E.restoreElements([{...base,id:'ink',type:'freedraw',pressures:[0.1,0.9],simulatePressure:false}],null);
    const line=E.restoreElements([{...base,customData:{controlPoints:[[0,100],[100,0]]}}],null);
    const plain=E.restoreElements([base],null);
    const svg=async elements=>(await E.exportToSvg({elements,appState:{exportBackground:false},files:{}})).outerHTML;
    // Ignore generated node IDs when comparing the geometry paths.
    const geometry=async elements=>Array.from(new DOMParser().parseFromString(await svg(elements),'image/svg+xml').querySelectorAll('path')).map(p=>p.getAttribute('d'));
    return {unknownPathCount:unknown.length,pressure:pressure[0].pressures,customControlPointsRetained:line[0].customData.controlPoints,
      plainGeometry:await geometry(plain), customHandlesChangeRenderedGeometry:JSON.stringify(await geometry(line))!==JSON.stringify(await geometry(plain)),
      historyKeys:Object.keys(api.history),apiKeys:Object.keys(api).sort(), captureActions:E.CaptureUpdateAction};
  });
  assert.equal(runtime.unknownPathCount, 0);
  assert.deepEqual(runtime.pressure, [0.1, 0.9]);
  assert.ok(runtime.plainGeometry.length > 0, 'Comparison must contain real SVG paths');
  assert.equal(runtime.customHandlesChangeRenderedGeometry, false);
  const before = await page.evaluate(() => window.changes.length);
  await page.evaluate(() => window.api.updateScene({elements:window.E.restoreElements([{type:'rectangle',id:'remote',x:30,y:30,width:100,height:80}],null),captureUpdate:window.E.CaptureUpdateAction.NEVER}));
  await page.waitForFunction(before => window.changes.length > before, before);
  runtime.neverProjectionEmitsOnChange = true;
  runtime.browser = browser.version();
} finally { await browser.close(); }
const result = { version, integrity: expectedIntegrity, archiveSha256: createHash('sha256').update(archive).digest('hex'), license: pkg.license,
  peers: pkg.peerDependencies, sourceMapEvidence: evidence,
  publicTypeEvidence: { arbitraryPathVariant: /type: "path"/.test(elementTypes), rendererHook: /renderElement\??:/.test(types), embeddableHook: /renderEmbeddable\??:/.test(types) },
  runtime, limits: ['No physical input or sustained performance measured', 'No mixed GIF/paint z-order runtime proof', 'No unified Studio history/remote rebase proof', 'No Vite production integration/self-hosted font load proof'], scratch };
await writeFile(join(scratch, 'result.json'), JSON.stringify(result, null, 2)+'\n');
console.log(JSON.stringify(result, null, 2));
