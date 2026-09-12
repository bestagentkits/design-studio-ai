import { diagramHitTarget, diagramEdgeHitTarget } from '../src/shared/diagram-hit-testing';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boardSchema} from '../src/shared/board-schema';
import {diagramNode,diagramEdge} from '../src/shared/diagram-presets';
import {diagramConnectorPoints,nearestDiagramBinding} from '../src/shared/diagram-routing';
import {diagramTextLines,diagramTextWidth} from '../src/shared/diagram-text';
import {applyDiagramOperation} from '../src/shared/diagram-operations';
import {createDocument} from '../src/shared/catalog';
import {upgradeDocument} from '../src/shared/document-upgrade';
import {boardSvg} from '../src/shared/board-render';
import {layoutDiagram} from '../src/shared/diagram-layout';
function document(){const d=upgradeDocument(createDocument('slides'));d.boards=[boardSchema.parse({id:'b',name:'Diagram',elements:[]})];return d;}
test('handwriting uses actual glyph advances and wraps Vietnamese without dropping characters',()=>{
  assert.ok(diagramTextWidth('WWW','Patrick Hand',24)>diagramTextWidth('iii','Patrick Hand',24)*2);
  const label='Thiết kế trải nghiệm và kết nối ý tưởng';
  const lines=diagramTextLines(label,'Patrick Hand',24,160);
  assert.equal(lines.join(' '),label);assert.ok(lines.every(s=>diagramTextWidth(s,'Patrick Hand',24)<=160));
  assert.equal(diagramTextWidth('ế','Patrick Hand',24),diagramTextWidth('e\u0302\u0301','Patrick Hand',24));
});
test('diagram styles preserve overrides and locks, save presets/defaults, and resize text',()=>{
  let d=document();d=upgradeDocument(applyDiagramOperation(d,{op:'diagram-node',boardId:'b',id:'n',family:'flowchart',role:'process',label:'Hello',x:0,y:0}));
  const before=structuredClone(d);
  d=upgradeDocument(applyDiagramOperation(d,{op:'diagram-style',boardId:'b',style:{fillStyle:'cross-hatch',fontSize:40},elementIds:['n'],setDefault:true,savePreset:'Large sketch'}));
  assert.equal(d.boards[0].diagramPresets?.[0].name,'Large sketch');assert.equal(d.boards[0].diagramDefaults?.fontSize,40);
  assert.ok(d.boards[0].elements[0].height>before.boards[0].elements[0].height);
  d.boards[0].elements[0].locked=true;
  assert.throws(()=>applyDiagramOperation(d,{op:'diagram-style',boardId:'b',style:{roughness:0},elementIds:['n'],setDefault:false}),/Unlock/);
  assert.equal(before.boards[0].elements[0].diagram?.fontSize,24);
});
test('backward edges leave source and enter target on their bound side without crossing nodes',()=>{
  const a=diagramNode('a','flowchart','process','Source',400,200),b=diagramNode('b','flowchart','process','Target',0,0),edge=diagramEdge('edge','a','b');
  const board=boardSchema.parse({id:'b',name:'Ports',elements:[a,b,edge]}),points=diagramConnectorPoints(board,edge);
  assert.ok(points[1].x>a.x+a.width);assert.ok(points.at(-2)!.x<b.x);
  for(const n of [a,b])for(let i=1;i<points.length;i++){
    const p=points[i-1],q=points[i];
    assert.ok(!(p.y===q.y && p.y>n.y && p.y<n.y+n.height && Math.max(p.x,q.x)>n.x && Math.min(p.x,q.x)<n.x+n.width));
    assert.ok(!(p.x===q.x && p.x>n.x && p.x<n.x+n.width && Math.max(p.y,q.y)>n.y && Math.min(p.y,q.y)<n.y+n.height));
  }
});
test('shared SVG is deterministic, embeds fonts and uses real sketch curves/hatching',()=>{
  const d=document(),n=diagramNode('n','flowchart','process','Ý tưởng');if('fillStyle'in n)n.fillStyle='hachure';d.boards[0].elements=[n];
  const render=()=>boardSvg(d.boards[0],d,{x:0,y:0,width:400,height:200},400,200);
  assert.equal(render(),render());assert.match(render(),/data:font\/woff2;base64/);assert.ok(/C[-\d.]/.test(render().split('</style>')[1]));assert.match(render(),/Patrick Hand/);assert.match(render(),/Ý tưởng/);
});
test('tree layout allocates space for uneven subtrees and preserves non-diagram artwork',()=>{
  const nodes=Array.from({length:7},(_,i)=>diagramNode(`n${i}`,'mind-map','topic',`Topic ${i}`));
  const artwork={id:'art-1',name:'Artwork',type:'shape',x:2000,y:2000,width:100,height:100,shape:'rectangle',fill:'#ffffff',stroke:'#111111',strokeWidth:1};
  const board=boardSchema.parse({id:'b',name:'Tree',elements:[...nodes,artwork],mindMap:nodes.map((n,i)=>({elementId:n.id,parentId:i?(i<3?'n0':'n1'):undefined}))});
  const result=layoutDiagram(board,'tree');
  for(const a of result.elements)for(const b of result.elements)if(a.id!==b.id)assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
  const preserved=result.elements.find(e=>e.id==='art-1');
  assert.deepEqual(preserved,board.elements.find(e=>e.id==='art-1'));
  assert.deepEqual({x:preserved!.x,y:preserved!.y,width:preserved!.width,height:preserved!.height},{x:2000,y:2000,width:100,height:100});
  const children=board.mindMap!.filter(m=>m.parentId==='n1').map(m=>result.elements.find(e=>e.id===m.elementId)!);
  assert.equal(children.length,4);
  const parent=result.elements.find(e=>e.id==='n1')!;
  assert.ok(Math.abs(parent.y+parent.height/2-(Math.min(...children.map(c=>c.y))+Math.max(...children.map(c=>c.y+c.height)))/2)<1e-9);
});
test('label-only patches preserve ports, fonts and sizing; style-only patches preserve all other appearance',()=>{
  let d=document();d.boards[0].elements=[diagramNode('n','flowchart','process','Before')];
  d=upgradeDocument(applyDiagramOperation(d,{op:'diagram-update',boardId:'b',elementId:'n',changes:{label:'Sau chỉnh sửa'}}));
  assert.equal(d.boards[0].elements[0].diagram?.ports.length,4);assert.equal(d.boards[0].elements[0].diagram?.fontFamily,'Patrick Hand');
  d=upgradeDocument(applyDiagramOperation(d,{op:'diagram-style',boardId:'b',elementIds:['n'],style:{roughness:2,stroke:'#884422'},setDefault:false}));
  d=upgradeDocument(applyDiagramOperation(d,{op:'diagram-style',boardId:'b',elementIds:['n'],style:{fillStyle:'hachure'},setDefault:false}));
  const n=d.boards[0].elements[0];assert.ok('roughness' in n);assert.equal(n.roughness,2);assert.equal(n.stroke,'#884422');
});
test('curved labels follow sampled curve rather than the endpoint chord',()=>{
  const edge=diagramEdge('edge','a','b');edge.routing='curve';edge.bends=[{x:280,y:400}];
  const board=boardSchema.parse({id:'board',name:'Curve',elements:[diagramNode('a','flowchart','process','A'),diagramNode('b','flowchart','process','B',400),edge]});
  const points=diagramConnectorPoints(board,edge);assert.equal(points.length,33);assert.ok(points[16].y>200);
});

test('routing exits rotated node bounds and layout avoids children of locked containers',()=>{
  const a=diagramNode('a','flowchart','process','Rotated',0,0), b=diagramNode('b','flowchart','process','B',500,300);a.rotation=45;
  const board=boardSchema.parse({id:'b',name:'Rotated',elements:[a,b,diagramEdge('edge','a','b')]});
  assert.ok(diagramConnectorPoints(board,board.elements[2] as ReturnType<typeof diagramEdge>).length>=4);
  const frame={id:'frame',type:'frame',name:'Locked',label:'Locked',stroke:'#000000',fill:'none',strokeWidth:2,x:0,y:0,width:300,height:200,locked:true};
  a.rotation=0;a.parentId='frame';a.x=80;a.y=80;
  const locked=boardSchema.parse({id:'b',name:'Locked children',elements:[frame,a,b]});
  const result=layoutDiagram(locked,'layered'),child=result.elements.find(n=>n.id==='a')!,moved=result.elements.find(n=>n.id==='b')!;
  assert.equal(child.x,80);assert.equal(child.y,80);
  assert.ok(child.x+child.width<=moved.x||moved.x+moved.width<=child.x||child.y+child.height<=moved.y||moved.y+moved.height<=child.y);
});

test('connector label appearance uses defaults and can change independently from its stroke',()=>{
  let d=document();d.boards[0].elements=[diagramNode('a','flowchart','process','A'),diagramNode('target','flowchart','process','B',400)];
  d=upgradeDocument(applyDiagramOperation(d,{op:'diagram-style',boardId:'b',elementIds:[],style:{fontFamily:'Lora',fontSize:32,textColor:'#aa0000'},setDefault:true}));
  d=upgradeDocument(applyDiagramOperation(d,{op:'diagram-connect',boardId:'b',id:'edge',sourceId:'a',targetId:'target',label:'Next'}));
  const edge=d.boards[0].elements[2];assert.equal(edge.type,'connector');if(edge.type!=='connector')return;
  assert.equal(edge.labelFontFamily,'Lora');assert.equal(edge.labelFontSize,32);assert.equal(edge.labelColor,'#aa0000');
  assert.match(boardSvg(d.boards[0],d,{x:0,y:0,width:640,height:200},640,200),/fill="#aa0000"[^>]*>Next<\/text>/);
});

test('transparent or hatched node interiors remain hit targets and hidden branches do not',()=>{
 const node=diagramNode('hit','flowchart','process','Hit',100,100);if('fillStyle'in node){node.fill='none';node.fillStyle='hachure';}node.rotation=45;
 const board=boardSchema.parse({id:'board',name:'Hit',elements:[node]});
 assert.equal(diagramHitTarget(board,{x:190,y:140})?.id,'hit');
 assert.equal(diagramHitTarget(board,{x:-100,y:-100}),undefined);
 board.elements[0].visible=false;assert.equal(diagramHitTarget(board,{x:190,y:140}),undefined);
});

test('center drops bind to the incoming side while near-edge drops keep their chosen port',()=>{
 const node=diagramNode('target','flowchart','process','Target',400,100);
 assert.equal(nearestDiagramBinding(node,{x:490,y:140},{x:100,y:140}).port,'left');
 assert.equal(nearestDiagramBinding(node,{x:490,y:179},{x:100,y:140}).port,'bottom');
});

test('thin connector hit tolerance follows its actual curve',()=>{
 const a=diagramNode('source','flowchart','process','A'),b=diagramNode('target','flowchart','process','B',400,200),edge=diagramEdge('line',a.id,b.id);edge.routing='curve';
 const board=boardSchema.parse({id:'board',name:'Edges',elements:[a,b,edge]}),point=diagramConnectorPoints(board,edge)[16];
 assert.equal(diagramEdgeHitTarget(board,{x:point.x,y:point.y+2},6)?.id,'line');
 assert.equal(diagramEdgeHitTarget(board,{x:-500,y:-500},6),undefined);
});

test('transparent connector text survives unrelated appearance updates',()=>{
 let d=document();d.boards[0].elements=[diagramNode('source','flowchart','process','A'),diagramNode('target','flowchart','process','B',400),diagramEdge('edge','source','target','Label')];
 d=upgradeDocument(applyDiagramOperation(d,{op:'diagram-edge',boardId:'b',edgeId:'edge',labelColor:'none'}));
 d=upgradeDocument(applyDiagramOperation(d,{op:'diagram-style',boardId:'b',elementIds:['edge'],style:{roughness:2},setDefault:false}));
 const edge=d.boards[0].elements[2];assert.equal(edge.type,'connector');if(edge.type==='connector')assert.equal(edge.labelColor,'none');
});
