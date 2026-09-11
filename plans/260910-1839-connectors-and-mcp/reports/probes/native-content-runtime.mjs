import assert from 'node:assert/strict';
import { generateKeyPairSync,verify } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
const root=new URL('../../../../',import.meta.url),keys=generateKeyPairSync('rsa',{modulusLength:2048});
const worker=await build({stdin:{resolveDir:root.pathname,contents:`
import {extractSourcePdf} from './server/connectors/google-content.ts';
import {createPrivateKey,sign} from 'node:crypto';
export default {async fetch(request,env){try{const text=await extractSourcePdf(new Uint8Array(await request.arrayBuffer()));const signature=sign('RSA-SHA256',Buffer.from('isolated-jwt-signing-check'),createPrivateKey(env.KEY)).toString('base64');return Response.json({text:new TextDecoder().decode(text),signature});}catch(error){return Response.json({code:error.code,message:error.message},{status:error.status??500});}}};`},bundle:true,write:false,platform:'browser',format:'esm',conditions:['workerd'],external:['node:*'],minify:true});
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-09-07',compatibilityFlags:['nodejs_compat'],bindings:{KEY:keys.privateKey.export({format:'pem',type:'pkcs8'}).toString()},script:worker.outputFiles[0].text}));
const browser=await chromium.launch();
try{
 const page=await browser.newPage();await page.setContent('<h1>Isolated source content</h1><p>Private PDF runtime check.</p>');const bytes=await page.pdf();
 const started=Date.now(),response=await runtime.dispatchFetch('http://native-runtime.test',{method:'POST',body:bytes}),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.match(result.text,/Private PDF runtime check/);assert.ok(verify('RSA-SHA256',Buffer.from('isolated-jwt-signing-check'),keys.publicKey,Buffer.from(result.signature,'base64')));
 console.log(JSON.stringify({runtime:'local workerd',pdfTextVerified:true,rsaJwtSigningVerified:true,pdfBytes:bytes.length,wallTimeMs:Date.now()-started,bundleBytes:worker.outputFiles[0].contents.length,cpuBudgetMeasured:false}));
}finally{await browser.close();await runtime.dispose();}
