import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../src/shared/catalog';
import { upgradeDocument, restoreDocumentSnapshot } from '../src/shared/document-upgrade';
import { paintingRecoveryMatches } from '../src/app/painting-recovery-state';
import type { Painting } from '../src/shared/painting-schema';
function painting(): Painting {
  return { id:'paint',name:'Paint',width:512,height:512,generation:4,colorSpace:'srgb',algorithm:'cpu-srgb-grain-v1',tileSize:512,groups:[{id:'group',name:'Group',visible:true,opacity:1}],layers:[{id:'layer',name:'Layer',tiles:[{x:0,y:0,assetId:'tile',hash:'a'.repeat(64),generation:4}],mask:{enabled:true,tiles:[{x:0,y:0,assetId:'mask',hash:'b'.repeat(64),generation:4}]},visible:true,locked:false,opacity:1,blend:'normal',alphaLock:false,clipping:false}] };
}
test('saved redo with fresh generation is recognized as the prepared content',()=>{
  const prepared=painting(), before=upgradeDocument(createDocument('slides')); before.paintings=[prepared]; before.assets.push(...['tile','mask'].map(id=>({id,name:id,type:'image',mimeType:'image/png',url:`/api/assets/${id}`})));
  const undo=structuredClone(before); undo.paintings[0].layers[0].mask!.enabled=false;
  const undone=restoreDocumentSnapshot(before,undo) as typeof before;
  const redone=restoreDocumentSnapshot(undone,before) as typeof before;
  assert.ok(redone.paintings[0].generation>prepared.generation);
  redone.paintings[0].composite={assetId:'new-preview',generation:redone.paintings[0].generation,sourceHash:'c'.repeat(64)};
  assert.equal(paintingRecoveryMatches(prepared,redone.paintings[0]),true);
});
test('different pixels, mask state and group settings retain recovery even at a higher generation',()=>{
  const prepared=painting();
  for(const edit of [(p:Painting)=>{p.layers[0].tiles[0].hash='d'.repeat(64);},(p:Painting)=>{p.layers[0].mask!.enabled=false;},(p:Painting)=>{p.groups[0].opacity=.5;}]){
    const current=structuredClone(prepared);current.generation++;edit(current);assert.equal(paintingRecoveryMatches(prepared,current),false);
  }
});
test('different painting identities cannot clear each other recovery',()=>{
  const prepared=painting(),current=structuredClone(prepared);current.id='another';assert.equal(paintingRecoveryMatches(prepared,current),false);
});
