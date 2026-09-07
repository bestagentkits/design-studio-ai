import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../src/shared/catalog';
import { inspectDesign } from '../src/shared/design-checks';

test('preflight locates actionable text/media/crop issues without changing the document', () => {
  const doc = createDocument('web','Preflight');
  doc.pages[0].background = '#ffffff';
  doc.pages[0].nodes = [
    {id:'title',name:'Title',type:'text',x:0,y:0,width:100,height:10,text:'A long heading that needs much more space',style:{fontSize:24,fill:'#ffffff'}},
    {id:'photo',name:'Photo',type:'image',x:-1,y:0,width:100,height:100},
    {id:'remote',name:'Remote',type:'video',x:0,y:0,width:100,height:100,src:'https://example.org/video.mp4'},
    {id:'hidden',name:'Hidden',type:'text',x:0,y:0,width:0,height:0,visible:false},
  ];
  const before=JSON.stringify(doc), result=inspectDesign(doc);
  assert.equal(JSON.stringify(doc),before);
  assert.ok(result.issues.some(issue=>issue.nodeId==='title'&&issue.code==='text-overflow'));
  assert.ok(result.issues.some(issue=>issue.nodeId==='title'&&issue.code==='text-contrast'));
  assert.ok(result.issues.some(issue=>issue.nodeId==='photo'&&issue.code==='missing-media'));
  assert.ok(result.issues.some(issue=>issue.nodeId==='photo'&&issue.code==='outside-page'));
  assert.ok(result.issues.some(issue=>issue.nodeId==='remote'&&issue.code==='remote-media'));
  assert.ok(result.issues.every(issue=>issue.nodeId!=='hidden'));
  assert.equal(result.counts.total,result.issues.length);
});

test('preflight uses declared parent color and bounds output for large documents', () => {
  const doc=createDocument('slides','Readable');
  doc.pages[0].background='#000000';
  doc.pages[0].nodes=[
    {id:'panel',name:'Panel',type:'frame',x:0,y:0,width:500,height:300,style:{fill:'#fff'}},
    {id:'body',name:'Body',type:'text',parentId:'panel',x:10,y:10,width:400,height:80,text:'Readable copy',style:{fontSize:24,fill:'#000'}},
  ];
  assert.equal(inspectDesign(doc).issues.filter(issue=>issue.code==='text-contrast').length,0);
  doc.pages[0].nodes=Array.from({length:500},(_,i)=>({id:`n${i}`,name:'Empty',type:'image' as const,x:0,y:0,width:0,height:0}));
  const result=inspectDesign(doc);
  assert.equal(result.issues.length,200);
  assert.equal(result.counts.total,1000);
  assert.equal(result.truncated,true);
});
