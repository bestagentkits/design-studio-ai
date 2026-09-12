import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../src/shared/catalog';
import { documentSchema, type DesignNode } from '../src/shared/schema';
import { upgradeDocument } from '../src/shared/document-upgrade';
import { communityProjection } from '../src/shared/community-projection';
import { characterSchema, characterInstanceSchema } from '../src/shared/character-schema';
import { evaluateCharacter } from '../src/shared/character-runtime';
import { boardSchema } from '../src/shared/board-schema';
import { paintingSchema } from '../src/shared/painting-schema';

const node = (id: string, extra: Partial<DesignNode> = {}): DesignNode => ({id,type:'text',name:id,x:0,y:0,width:100,height:100,...extra});
const asset = (id: string) => ({id,name:`secret-${id}.png`,type:'image',mimeType:'image/png',url:`/api/assets/${id}`});

test('component projection preserves rendered props and excludes opaque or unused source props',()=>{
  const doc=createDocument();doc.pages[0].nodes=[
    node('button',{type:'component',component:{name:'Button',system:'shadcn',props:{label:'Public',disabled:true,internalNotes:'PRIVATE',description:'UNRENDERED',items:['HIDDEN']}}}),
    node('chart',{type:'component',component:{name:'Chart',system:'antd',props:{label:'Revenue',values:['1','2'],items:['A','B'],privatePrompt:'PRIVATE'}}}),
    node('card',{type:'component',component:{name:'Card',system:'antd',props:{label:'Title',description:'Visible content',value:'UNRENDERED'}}}),
  ];
  const output=communityProjection(doc).document;
  assert.deepEqual(output.pages[0].nodes[0].component?.props,{label:'Public',disabled:true});
  assert.deepEqual(output.pages[0].nodes[1].component?.props,{label:'Revenue',values:['1','2'],items:['A','B']});
  assert.deepEqual(output.pages[0].nodes[2].component?.props,{label:'Title',description:'Visible content'});
  assert.equal(/PRIVATE|UNRENDERED|HIDDEN/.test(JSON.stringify(output)),false);
});

test('both document versions remove all hidden descendants, notes, private data, unused media and timeline tracks without mutating input', () => {
  for (const version of [1,2]) {
    const document = version === 1 ? createDocument() : upgradeDocument(createDocument());
    document.pages[0].notes = 'private notes';
    document.pages[0].nodes = [node('private-group',{type:'group',visible:false}),node('private-image',{type:'image',parentId:'private-group',src:'/api/assets/private'}),node('deep-secret',{parentId:'private-image',text:'secret'}),node('public-chart',{type:'chart',data:{values:[1,2],labels:['One','Two'],prompt:'SECRET',provider:'private-provider'},interactions:[{trigger:'click',action:'toggle',target:'private-group'}]})];
    document.assets = [asset('private'),asset('unused')];
    document.designSystem = {id:'private-library',name:'Library',version:1};
    document.timeline = {duration:2,fps:30,tracks:[{id:'private-track',nodeId:'private-image',keyframes:[]},{id:'public-track',nodeId:'public-chart',keyframes:[{time:0,values:{x:2,privatePrompt:'SECRET'}}]}]};
    const before = structuredClone(document), {document: result,disclosure} = communityProjection(document);
    assert.deepEqual(document,before);
    assert.deepEqual(result.pages[0].nodes.map(n=>n.id),['public-chart']);
    assert.deepEqual(result.pages[0].nodes[0].data,{values:[1,2],labels:['One','Two']});
    assert.deepEqual(result.pages[0].nodes[0].interactions,[]);
    assert.equal(result.pages[0].notes,undefined); assert.deepEqual(result.assets,[]);
    assert.equal(result.designSystem,undefined); assert.equal(disclosure.removedNodes,3);
    assert.equal(result.timeline?.tracks.length,1); assert.deepEqual(result.timeline!.tracks[0].keyframes[0].values,{x:2});
    assert.equal(JSON.stringify(result).includes('SECRET'),false); documentSchema.parse(result);
  }
});

test('character dependency closure keeps public switches and slider clips, excludes unused skins and source images, and preserves animation', () => {
  const document = upgradeDocument(createDocument());
  const character = characterSchema.parse({id:'character',name:'Character',width:100,height:100,bones:[{id:'root',name:'Root'}],slots:[{id:'slot',name:'Slot',boneId:'root',attachmentId:'private-default'}],attachments:[
    {id:'private-default',name:'PRIVATE',slotId:'slot',kind:'region',assetId:'private',width:10,height:10},
    {id:'public-attachment',name:'Public',slotId:'slot',kind:'region',assetId:'public',width:10,height:10},
    {id:'switch-attachment',name:'Switch',slotId:'slot',kind:'region',assetId:'switch',width:10,height:10},
  ],skins:[{id:'chosen',name:'Chosen',attachments:{slot:'public-attachment'}},{id:'hidden-skin',name:'PRIVATE',attachments:{slot:'private-default'}}],clips:[
    {id:'show',name:'Show',duration:1,bakedFrom:{clipId:'private-clip',fps:30},channels:[{id:'switch-channel',target:'slot',targetId:'slot',property:'attachment',keys:[{id:'key',time:.5,value:'switch-attachment'}]}]},
    {id:'private-clip',name:'PRIVATE',duration:1,channels:[]},
    {id:'slider-pose',name:'Pose',duration:1,channels:[]},
  ],constraints:[{id:'control',name:'Control',type:'slider',bones:['root'],clipId:'slider-pose'}]});
  const instance = characterInstanceSchema.parse({characterId:character.id,skinId:'chosen',clipId:'show'});
  document.characters = [character]; document.pages[0].nodes = [node('actor',{type:'character',character:instance})]; document.assets = [asset('private'),asset('public'),asset('switch')];
  const before = evaluateCharacter(character,instance,.75), result = communityProjection(document).document;
  const projected = result.characters![0];
  assert.deepEqual(projected.attachments.map(a=>a.id),['public-attachment','switch-attachment']);
  assert.deepEqual(projected.skins.map(a=>a.id),['chosen']); assert.deepEqual(projected.clips.map(c=>c.id),['show','slider-pose']);
  assert.equal(projected.clips[0].bakedFrom,undefined); assert.equal(projected.slots[0].attachmentId,undefined);
  assert.deepEqual(result.assets.map(a=>a.id),['public','switch']);
  assert.deepEqual(evaluateCharacter(projected,result.pages[0].nodes[0].character!,.75),before);
  // Concrete pinned outcome: the surviving switch channel must resolve the slot attachment at t=.75,
  // so a constant-returning evaluator cannot satisfy the invariance check above.
  const pose=evaluateCharacter(projected,result.pages[0].nodes[0].character!,.75);
  assert.deepEqual(pose.slots.slot,{attachment:'switch-attachment',opacity:1,order:0});
  assert.deepEqual(pose.bones.root,{x:0,y:0,rotation:0,scaleX:1,scaleY:1});
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false); documentSchema.parse(result);
});

test('linked mesh copies required geometry without exposing the unused source attachment image', () => {
  const document = upgradeDocument(createDocument());
  document.characters = [characterSchema.parse({id:'rig',name:'Rig',width:100,height:100,bones:[{id:'bone',name:'Bone'}],slots:[{id:'slot',name:'Slot',boneId:'bone',attachmentId:'linked'}],skins:[],clips:[],attachments:[{id:'source',name:'PRIVATE',slotId:'slot',kind:'mesh',assetId:'private',width:10,height:10,mesh:{version:1,vertices:[[0,0],[1,0],[0,1]],uv:[[0,0],[1,0],[0,1]],triangles:[0,1,2]}},{id:'linked',name:'Public',slotId:'slot',kind:'mesh',sourceMeshId:'source',assetId:'public',width:10,height:10}]})];
  document.assets = [asset('private'),asset('public')]; document.pages[0].nodes = [node('actor',{type:'character',character:characterInstanceSchema.parse({characterId:'rig'})})];
  const result = communityProjection(document).document;
  assert.equal(result.characters![0].attachments.length,1); assert.ok(result.characters![0].attachments[0].mesh); assert.equal(result.characters![0].attachments[0].sourceMeshId,undefined); assert.deepEqual(result.assets.map(a=>a.id),['public']); documentSchema.parse(result);
});

test('boards remove hidden ancestry and bound edges; paintings share only verified composites', () => {
  const document = upgradeDocument(createDocument());
  document.assets = [asset('tile'),asset('composite')];
  document.paintings = [paintingSchema.parse({id:'paint',name:'Paint',width:100,height:100,generation:1,colorSpace:'srgb',algorithm:'cpu-srgb-grain-v1',tileSize:512,layers:[{id:'layer',name:'PRIVATE LAYER',visible:true,locked:false,opacity:1,blend:'normal',tiles:[{x:0,y:0,assetId:'tile',generation:1,hash:'0'.repeat(64)}]}],composite:{assetId:'composite',generation:1,sourceHash:'0'.repeat(64)}})];
  document.boards = [boardSchema.parse({id:'board',name:'Board',elements:[{id:'hidden',name:'Secret group',type:'group',x:0,y:0,width:10,height:10,visible:false},{id:'hidden-child',name:'SECRET',type:'group',parentId:'hidden',x:0,y:0,width:10,height:10},{id:'art',name:'Art',type:'painting',paintingId:'paint',x:0,y:0,width:100,height:100}]})];
  document.pages[0].nodes = [node('board-node',{type:'board',boardId:'board',crop:{x:0,y:0,width:100,height:100}})];
  const {document:result,disclosure} = communityProjection(document);
  assert.equal(result.schemaVersion,2); if(result.schemaVersion!==2) return;
  assert.deepEqual(result.paintings,[]); assert.equal(result.boards[0].elements.length,1); assert.equal(result.boards[0].elements[0].type,'image'); assert.deepEqual(result.assets.map(a=>a.id),['composite']); assert.equal(disclosure.flattenedPaintings,1); assert.equal(JSON.stringify(result).includes('PRIVATE LAYER'),false);
  delete document.paintings[0].composite; assert.throws(()=>communityProjection(document),/verified visible composite/);
});

test('visible legacy models cannot depend on hidden rigs', () => {
  const document = createDocument(); document.pages[0].nodes = [node('hidden-rig',{type:'model3d',visible:false}),node('model',{type:'model3d',data:{rigSourceId:'hidden-rig'}})];
  assert.throws(()=>communityProjection(document),/depends on a hidden rig/);
});
