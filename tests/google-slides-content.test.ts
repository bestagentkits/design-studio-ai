import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDocument } from '../src/shared/catalog';
import { googleSlidesRequests } from '../server/google-slides-content';

test('native Slides resolves flow positions without mutating the saved document',()=>{
  const doc=createDocument('slides','Layout export');
  const page=doc.pages[0];doc.pages=[page];page.width=720;page.height=405;
  page.layout={mode:'flex',direction:'column',padding:20,gap:10};
  page.nodes=[{id:'a',type:'text',name:'First',text:'First',x:0,y:0,width:100,height:30},{id:'b',type:'text',name:'Second',text:'Second',x:0,y:0,width:100,height:30}];
  const before=JSON.stringify(doc),requests=googleSlidesRequests(doc) as any[];
  const boxes=requests.filter(r=>r.createShape).map(r=>r.createShape.elementProperties.transform);
  assert.deepEqual(boxes.map(b=>[b.translateX,b.translateY]),[[20,20],[20,60]]);
  assert.equal(JSON.stringify(doc),before);
});
test('native Slides rejects web components before returning creation requests',()=>{
  const doc=createDocument('web','Unsupported component');
  assert.ok(doc.pages.some(p=>p.nodes.some(n=>n.type==='component')));
  assert.throws(()=>googleSlidesRequests(doc),(error:any)=>error.code==='unsupported_google_node');
});
