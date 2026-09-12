import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createDocument } from '../src/shared/catalog';
import { documentSchema } from '../src/shared/schema';
import { encodePaintPng } from '../src/shared/paint-png';
import { buildCommunityPackage, readCommunityPackage, communityPackageHash, COMMUNITY_PACKAGE_LIMITS } from '../src/shared/community-package';
import type { CommunityAttribution } from '../src/shared/community';

const credit: CommunityAttribution = {title:'Public artwork',creator:{handle:'artist',displayName:'Artist'},license:'CC-BY-4.0',listingId:'listing',version:1,verified:true};
async function fixture() {
  const png = new Uint8Array(await encodePaintPng(1,1,new Uint8Array([80,140,210,255])));
  const document = createDocument('web');
  document.pages[0].nodes = [{id:'image',name:'Image',type:'image',x:0,y:0,width:100,height:100,src:'/api/assets/private-id'}];
  document.pages[0].notes = 'PRIVATE SPEAKER NOTES';
  document.assets = [{id:'private-id',name:'PRIVATE FILENAME.png',type:'image',mimeType:'image/png',url:'/api/assets/private-id',size:png.length}];
  const assets = [{id:'private-id',name:'PRIVATE FILENAME.png',mimeType:'image/png',bytes:png}];
  return {document,png,assets,bytes:await buildCommunityPackage(document,assets,credit)};
}
test('a pinned package seed produces identical bytes after interrupted storage and separates other operations',async()=>{
  const {document,assets}=await fixture();
  const first=await buildCommunityPackage(document,assets,credit,'publication-job');
  const retry=await buildCommunityPackage(document,assets,credit,'publication-job');
  const other=await buildCommunityPackage(document,assets,credit,'other-job');
  assert.deepEqual(retry,first);assert.notDeepEqual(other,first);
  await readCommunityPackage(retry);
});
async function editArchive(bytes: Uint8Array, edit: (zip: JSZip)=>void|Promise<void>, compression: 'STORE'|'DEFLATE' = 'STORE') {
  const zip = await JSZip.loadAsync(bytes); await edit(zip);
  return zip.generateAsync({type:'uint8array',compression});
}
async function changeFile(zip: JSZip, path: string, bytes: Uint8Array) {
  zip.file(path,bytes,{createFolders:false});
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  const record = manifest.files.find((f:{path:string})=>f.path===path); record.size=bytes.length; record.sha256=await communityPackageHash(bytes);
  zip.file('manifest.json',JSON.stringify(manifest));
}
function centralEntries(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), eocd = bytes.length-22; let cursor=view.getUint32(eocd+16,true);
  const entries: {central:number;local:number;name:string}[]=[];
  for(let n=0;n<view.getUint16(eocd+10,true);n++) {
    const length=view.getUint16(cursor+28,true), extra=view.getUint16(cursor+30,true), comment=view.getUint16(cursor+32,true);
    entries.push({central:cursor,local:view.getUint32(cursor+42,true),name:new TextDecoder().decode(bytes.subarray(cursor+46,cursor+46+length))}); cursor+=46+length+extra+comment;
  }
  return entries;
}

test('real ZIP roundtrip has canonical document, independent media, terms and declared attribution, with no source notes or filenames', async () => {
  const {bytes,png,document} = await fixture(), result = await readCommunityPackage(bytes), zip = await JSZip.loadAsync(bytes);
  assert.ok(zip.file('manifest.json')); assert.ok(zip.file('LICENSE.txt')); assert.ok(zip.file('README.md')); assert.ok(zip.file('ATTRIBUTION.json'));
  assert.equal(result.assets.length,1); assert.deepEqual(result.assets[0].bytes,png);
  assert.notEqual(result.assets[0].id,'private-id'); assert.equal(result.document.assets[0].url,`/api/assets/${result.assets[0].id}`);
  assert.equal(result.document.pages[0].nodes[0].src,result.document.assets[0].url);
  assert.equal(result.document.pages[0].notes,undefined); assert.equal(result.attribution.verified,false);
  assert.equal(document.pages[0].notes,'PRIVATE SPEAKER NOTES'); documentSchema.parse(result.document);
  for(const name of ['document.json','manifest.json','ATTRIBUTION.json']) assert.doesNotMatch(await zip.file(name)!.async('string'),/PRIVATE|private-id/);
});

test('inline image media becomes a manifest-owned file with decoded bytes charged', async () => {
  const {document,png} = await fixture(); document.assets=[];
  document.pages[0].nodes[0].src=`data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  const result=await readCommunityPackage(await buildCommunityPackage(document,[],credit));
  assert.equal(result.assets.length,1); assert.deepEqual(result.assets[0].bytes,png); assert.equal(result.document.assets[0].size,png.length);
  assert.match(result.document.pages[0].nodes[0].src!,/^\/api\/assets\/package-/);
});

test('compressed packages and data descriptors are accepted with identical verified bytes', async () => {
  const {bytes,png}=await fixture();
  const compressed=await editArchive(bytes,()=>{},'DEFLATE');
  assert.deepEqual((await readCommunityPackage(compressed)).assets[0].bytes,png);
  const zip=await JSZip.loadAsync(bytes); const streamed=await zip.generateAsync({type:'uint8array',compression:'DEFLATE',streamFiles:true});
  assert.deepEqual((await readCommunityPackage(streamed)).assets[0].bytes,png);
});

test('builder refuses missing, remote and MIME-mismatched dependencies; links remain links', async () => {
  const {document,assets}=await fixture();
  await assert.rejects(buildCommunityPackage(document,[],credit),/missing/);
  for(const url of ['https://example.com/private.png','/published/secret/assets/image']) {
    const copy=structuredClone(document); copy.assets[0].url=url; copy.pages[0].nodes[0].src=url;
    await assert.rejects(buildCommunityPackage(copy,assets,credit),/Import remote/);
  }
  await assert.rejects(buildCommunityPackage(document,[{...assets[0],mimeType:'image/jpeg'}],credit),/MIME/);
  document.pages[0].nodes[0].interactions=[{trigger:'click',action:'url',target:'https://example.com/about'}];
  const imported=await readCommunityPackage(await buildCommunityPackage(document,assets,credit));
  assert.equal(imported.document.pages[0].nodes[0].interactions![0].target,'https://example.com/about');
});

test('tampered CRC, SHA-256 and manifest mappings are rejected', async () => {
  const {bytes}=await fixture();
  const tampered=bytes.slice(), entry=centralEntries(tampered).find(e=>e.name.startsWith('assets/'))!, view=new DataView(tampered.buffer);
  tampered[entry.local+30+view.getUint16(entry.local+26,true)]^=1;
  await assert.rejects(readCommunityPackage(tampered),/CRC/);
  const badHash=await editArchive(bytes,async zip=>{ const path=Object.keys(zip.files).find(p=>p.startsWith('assets/'))!; const payload=await zip.file(path)!.async('uint8array'); payload[payload.length-1]^=1; zip.file(path,payload,{createFolders:false}); });
  await assert.rejects(readCommunityPackage(badHash),/SHA-256/);
  const wrongMapping=await editArchive(bytes,async zip=>{const manifest=JSON.parse(await zip.file('manifest.json')!.async('string'));manifest.assets[0].id='other';zip.file('manifest.json',JSON.stringify(manifest));});
  await assert.rejects(readCommunityPackage(wrongMapping),/mapping/);
});

test('unmapped private and remote references and unreferenced assets cannot escape through document.json', async () => {
  const {bytes}=await fixture();
  for(const url of ['/api/assets/guess-private-id','https://example.com/media.png','data:image/png;base64,YQ==']) {
    const edited=await editArchive(bytes,async zip=>{const doc=JSON.parse(await zip.file('document.json')!.async('string'));doc.pages[0].nodes[0].src=url;await changeFile(zip,'document.json',new TextEncoder().encode(JSON.stringify(doc)));});
    await assert.rejects(readCommunityPackage(edited),/unmapped media|never fetches/);
  }
  const orphan=await editArchive(bytes,async zip=>{const doc=JSON.parse(await zip.file('document.json')!.async('string'));doc.pages[0].nodes=[];await changeFile(zip,'document.json',new TextEncoder().encode(JSON.stringify(doc)));});
  await assert.rejects(readCommunityPackage(orphan),/unreferenced/);
});

test('ZIP traversal, nested archives, directories, symlinks and duplicate names are rejected', async () => {
  const {bytes}=await fixture();
  for(const name of ['../secret.txt','/absolute.txt','assets\\bad.png','payload.zip','assets/']) {
    const unsafe=await editArchive(bytes,zip=>{zip.file(name,'x',{createFolders:false});});
    await assert.rejects(readCommunityPackage(unsafe),/Unsafe|symlink/);
  }
  const symlink=await editArchive(bytes,zip=>{zip.file('README.md','target',{unixPermissions:0o120777});});
  // JSZip defaults to DOS; set the Unix type directly to exercise importer rejection.
  const view=new DataView(symlink.buffer), central=centralEntries(symlink).find(e=>e.name==='README.md')!.central;view.setUint32(central+38,0xa1ff0000,true);
  await assert.rejects(readCommunityPackage(symlink),/symlink/);
  const duplicate=bytes.slice(), duplicateView=new DataView(duplicate.buffer), entries=centralEntries(duplicate), original=entries.find(e=>e.name==='README.md')!, other=entries.find(e=>e.name==='LICENSE.txt')!;
  duplicateView.setUint32(other.central+42,original.local,true);
  await assert.rejects(readCommunityPackage(duplicate),/mismatch|Overlapping/);
});

test('encryption, ZIP64 sentinels, central/local disagreement, overlap and trailing bytes fail closed', async () => {
  const {bytes}=await fixture();
  for(const corrupt of [
    (b:Uint8Array)=>{const e=centralEntries(b)[0],v=new DataView(b.buffer);v.setUint16(e.central+8,0x801,true);v.setUint16(e.local+6,0x801,true);},
    (b:Uint8Array)=>{const e=centralEntries(b)[0];new DataView(b.buffer).setUint32(e.central+20,0xffffffff,true);},
    (b:Uint8Array)=>{const e=centralEntries(b)[0];new DataView(b.buffer).setUint16(e.local+8,8,true);},
    (b:Uint8Array)=>{const e=centralEntries(b);new DataView(b.buffer).setUint32(e[1].central+42,e[0].local,true);},
  ]) {const copy=bytes.slice();corrupt(copy);await assert.rejects(readCommunityPackage(copy),/ZIP|header/);}
  const trailing=new Uint8Array(bytes.length+1);trailing.set(bytes);await assert.rejects(readCommunityPackage(trailing),/end directory/);
});

test('actual streaming inflation rejects a declared-small decompression bomb before JSON parsing', async () => {
  const {bytes}=await fixture();
  const bomb=await editArchive(bytes,async zip=>{zip.file('manifest.json',' '.repeat(1024*1024)+await zip.file('manifest.json')!.async('string'));},'DEFLATE');
  const entry=centralEntries(bomb).find(e=>e.name==='manifest.json')!, view=new DataView(bomb.buffer);
  view.setUint32(entry.central+24,128,true);view.setUint32(entry.local+22,128,true);
  await assert.rejects(readCommunityPackage(bomb),/Actual inflated ZIP bytes/);
});

test('native inflation receives bounded input chunks and stops consuming a bomb when output exceeds its declaration', async t => {
  const {bytes}=await fixture();
  const bomb=await editArchive(bytes,async zip=>{zip.file('manifest.json',' '.repeat(64*1024*1024)+await zip.file('manifest.json')!.async('string'));},'DEFLATE');
  const entry=centralEntries(bomb).find(e=>e.name==='manifest.json')!,view=new DataView(bomb.buffer),compressedBytes=view.getUint32(entry.central+20,true);
  view.setUint32(entry.central+24,128,true);view.setUint32(entry.local+22,128,true);
  const NativeDecompressionStream=globalThis.DecompressionStream,inputSizes:number[]=[];
  class ObservedDecompressionStream {
    readonly readable:ReadableStream<Uint8Array>;
    readonly writable:WritableStream<BufferSource>;
    constructor(format:CompressionFormat) {
      const observer=new TransformStream<BufferSource,BufferSource>({transform(chunk,controller){inputSizes.push(chunk.byteLength);controller.enqueue(chunk);}});
      this.writable=observer.writable;this.readable=observer.readable.pipeThrough(new NativeDecompressionStream(format));
    }
  }
  t.mock.method(globalThis,'DecompressionStream',ObservedDecompressionStream as typeof DecompressionStream);
  await assert.rejects(readCommunityPackage(bomb),/Actual inflated ZIP bytes/);
  assert.ok(inputSizes.length>0);assert.ok(inputSizes.every(size=>size<=1024));
  assert.ok(inputSizes.reduce((total,size)=>total+size,0)<compressedBytes,'Cancellation must stop native inflation before all compressed bomb bytes are consumed');
});

test('JSON nesting and ZIP admission limits are enforced', async () => {
  const {bytes}=await fixture();
  const nested=await editArchive(bytes,async zip=>{await changeFile(zip,'document.json',new TextEncoder().encode('['.repeat(65)+'0'+']'.repeat(65)));});
  await assert.rejects(readCommunityPackage(nested),/nesting/);
  await assert.rejects(readCommunityPackage(new Uint8Array(COMMUNITY_PACKAGE_LIMITS.zipBytes+1)),/20 MiB/);
  const tooMany=bytes.slice(),v=new DataView(tooMany.buffer);v.setUint16(tooMany.length-12,1001,true);v.setUint16(tooMany.length-14,1001,true);
  await assert.rejects(readCommunityPackage(tooMany),/oversized ZIP/);
});

test('GLB nested dependencies require binary embedding before packaging', async () => {
  const {document}=await fixture();
  const json=new TextEncoder().encode(JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'https://private.example/geometry.bin',byteLength:12}]}));
  const length=Math.ceil(json.length/4)*4,glb=new Uint8Array(20+length),view=new DataView(glb.buffer);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,glb.length,true);view.setUint32(12,length,true);view.setUint32(16,0x4e4f534a,true);glb.fill(32,20);glb.set(json,20);
  document.pages[0].nodes[0].type='model3d';document.assets[0].mimeType='model/gltf-binary';
  await assert.rejects(buildCommunityPackage(document,[{id:'private-id',name:'Model',mimeType:'model/gltf-binary',bytes:glb}],credit),/external or inline media dependencies/);
});

