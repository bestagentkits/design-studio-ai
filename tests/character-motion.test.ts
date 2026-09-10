import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument} from '../src/shared/catalog';
import {documentSchema} from '../src/shared/schema';
import {mutateDocument} from '../src/shared/operations';
import {characterSchema,characterInstanceSchema,constraintSchema,motionChannelSchema} from '../src/shared/character-schema';
import {evaluateCharacter,attachmentVertices} from '../src/shared/character-runtime';
import {worldMatrices,point} from '../src/shared/character-math';
import {sampleChannel} from '../src/shared/motion-channels';
import {gridMesh,retimeKeys,reparentBone} from '../src/shared/character-editing';
const rig=()=>characterSchema.parse({id:'rig',name:'Rig',width:256,height:256,bones:[{id:'root',name:'Root',length:100},{id:'arm',name:'Arm',parentId:'root',x:100,length:100}],slots:[],attachments:[],skins:[],clips:[{id:'walk',name:'Walk',duration:2,channels:[{id:'rotation',target:'bone',targetId:'root',property:'rotation',keys:[{id:'start',time:0,value:0},{id:'end',time:2,value:90}]}]}]});
const instance=()=>characterInstanceSchema.parse({characterId:'rig',clipId:'walk'});
test('v1 rejects character data; operations upgrade atomically and preserve existing document',()=>{
 const original=createDocument('web');const before=structuredClone(original);const updated=mutateDocument(original,[{op:'upsert-character',character:rig()}]);assert.equal(updated.schemaVersion,2);assert.deepEqual(original,before);
 assert.equal(documentSchema.safeParse({...updated,schemaVersion:1}).success,false);
 assert.throws(()=>mutateDocument(updated,[{op:'remove-character-item',characterId:'rig',collection:'bones',itemId:'root'}]),/parent|channel/);
 assert.equal(updated.characters![0].bones.length,2);
});
test('invalid dependencies, asset refs and geometry are rejected before evaluation',()=>{
 const doc={...createDocument(),schemaVersion:2 as const,characters:[rig()]};doc.characters[0].bones[0].parentId='arm';assert.equal(documentSchema.safeParse(doc).success,false);
 doc.characters=[rig()];doc.characters[0].constraints.push(constraintSchema.parse({id:'ik',name:'IK',type:'ik',bones:['root'],targetBoneId:'arm'}));assert.equal(documentSchema.safeParse(doc).success,false);
});
test('per-property curves are independent; discrete keys hold; authored turns remain unwrapped',()=>{
 const c=motionChannelSchema.parse({id:'c',target:'bone',targetId:'root',property:'rotation',keys:[{id:'a',time:0,value:0,easing:'linear'},{id:'b',time:2,value:720}]});assert.equal(sampleChannel(c,1),360);assert.equal(sampleChannel({...c,property:'order'},1),0);assert.equal(sampleChannel(c,2),720);
 const step=structuredClone(c);step.keys[0].easing='step';assert.equal(sampleChannel(step,1),0);
});
test('pose evaluation is pure, hierarchical and instances have independent clip placement clocks',()=>{
 const c=rig(),before=structuredClone(c),i=instance(),p=evaluateCharacter(c,i,1),world=worldMatrices(c.bones,p.bones);assert.ok(Math.abs(world.arm[4]-Math.sqrt(5000))<1e-6);assert.deepEqual(c,before);
 const other=characterInstanceSchema.parse({characterId:'rig',placements:[{id:'p',clipId:'walk',start:1,end:3}]});assert.equal(evaluateCharacter(c,other,1).bones.root.rotation,0);assert.equal(p.bones.root.rotation,45);
});
test('two-bone IK reaches its target and supports opposite bend directions and partial mix',()=>{
 const c=rig();c.clips=[];c.constraints=[constraintSchema.parse({id:'ik',name:'IK',type:'ik',bones:['root','arm'],target:[100,100]})];const i=characterInstanceSchema.parse({characterId:c.id});
 const positive=evaluateCharacter(c,i,0),end=point(worldMatrices(c.bones,positive.bones).arm,[100,0]);assert.ok(Math.hypot(end[0]-100,end[1]-100)<.1);
 c.constraints[0].bend='negative';const negative=evaluateCharacter(c,i,0);assert.ok(positive.bones.arm.rotation>0);assert.ok(negative.bones.arm.rotation<0);
 c.constraints[0].mix=.5;const half=evaluateCharacter(c,i,0);assert.ok(Math.abs(half.bones.arm.rotation-negative.bones.arm.rotation*.5)<1e-6);
});
test('physics replay gives same pose after forward, reverse and repeated seeks',()=>{
 const c=rig();c.constraints=[constraintSchema.parse({id:'spring',name:'Spring',type:'physics',bones:['root'],stiffness:25,damping:6})];const i=instance();const at=evaluateCharacter(c,i,1.4);evaluateCharacter(c,i,2);evaluateCharacter(c,i,.2);assert.deepEqual(evaluateCharacter(c,i,1.4),at);assert.deepEqual(evaluateCharacter(c,instance(),1.4),at);
});
test('weighted mesh bind pose and deformation use the same transform space',()=>{
 const c=rig();c.clips=[];c.slots=[{id:'slot',name:'Slot',boneId:'arm',attachmentId:'art',opacity:1,blend:'normal'}];const mesh=gridMesh(10,10,1,1);mesh.weights=mesh.vertices.map(()=>[{boneId:'root',weight:.5},{boneId:'arm',weight:.5}]);
 c.attachments=[{id:'art',name:'Art',slotId:'slot',kind:'mesh',assetId:'image',width:10,height:10,x:0,y:0,rotation:0,pivot:[0,0],mesh}];const p=evaluateCharacter(c,characterInstanceSchema.parse({characterId:'rig'}),0);assert.deepEqual(attachmentVertices(c,c.attachments[0],p),[[100,0],[110,0],[100,10],[110,10]]);
 p.deform.art=[1,2,0,0,0,0,0,0];assert.deepEqual(attachmentVertices(c,c.attachments[0],p)[0],[101,2]);
});
test('retiming refuses collisions without modifying keys; copied keys receive new IDs',()=>{
 const keys=rig().clips[0].channels[0].keys,before=structuredClone(keys);assert.throws(()=>retimeKeys(keys,new Set(['start']),2,1,0,2),/collide/);assert.deepEqual(keys,before);const copied=retimeKeys(keys,new Set(['start']),1,1,0,2,true);assert.equal(copied.length,3);assert.notEqual(copied[1].id,'start');
});
test('reparent keep-world preserves world transforms',()=>{const c=rig(),before=worldMatrices(c.bones,Object.fromEntries(c.bones.map(b=>[b.id,b]))).arm;reparentBone(c,'arm',undefined,true);assert.deepEqual(worldMatrices(c.bones,Object.fromEntries(c.bones.map(b=>[b.id,b]))).arm,before);});

test('baked physics reproduces sampled poses without solving constraints twice',async()=>{
 const {bakeMotion}=await import('../src/shared/motion-bake');const c=rig();c.constraints=[constraintSchema.parse({id:'spring',name:'Spring',type:'physics',bones:['root']})];const source=instance(),expected=evaluateCharacter(c,source,1),baked=bakeMotion(c,'walk','baked','Baked',12);const next={...c,clips:[...c.clips,baked]};const actual=evaluateCharacter(next,characterInstanceSchema.parse({characterId:'rig',clipId:'baked'}),1);assert.ok(Math.abs(actual.bones.root.rotation-expected.bones.root.rotation)<1e-8);assert.equal(baked.bakedFrom?.fps,12);
});
test('events emit only crossings, preserve loop cycles and ignore reverse seeks',async()=>{
 const {motionEvents}=await import('../src/shared/motion-events');const c=rig();c.clips[0].loop=true;c.clips[0].events=[{id:'step',name:'Footstep',time:.5}];assert.deepEqual(motionEvents(c,instance(),0,4).map(e=>[e.time,e.cycle]),[[.5,0],[2.5,1]]);assert.equal(motionEvents(c,instance(),.5,1).length,0);assert.equal(motionEvents(c,instance(),2,1).length,0);
});
test('additive masks preserve excluded bones and sparse channels retain setup values',()=>{
 const c=rig();c.bones[0].rotation=10;const i=characterInstanceSchema.parse({characterId:'rig',placements:[{id:'p',clipId:'walk',start:0,end:2,blend:'additive',weight:.5,mask:['arm']}]});assert.equal(evaluateCharacter(c,i,1).bones.root.rotation,10);i.placements[0].mask=['root'];assert.equal(evaluateCharacter(c,i,1).bones.root.rotation,27.5);
});
test('motion proposals exclude unrelated content and reject non-character edits',async()=>{
 const {motionProposalContext,parseMotionProposal}=await import('../src/shared/motion-proposal');const doc=createDocument('web');doc.pages[0].nodes=[{id:'private',name:'Confidential',type:'text',text:'Do not send me',x:0,y:0,width:10,height:10}];assert.ok(!JSON.stringify(motionProposalContext(doc)).includes('Confidential'));assert.throws(()=>parseMotionProposal(doc,[{op:'remove-page',pageId:doc.pages[0].id}]));assert.throws(()=>parseMotionProposal(doc,[{op:'update-node',nodeId:'private',changes:{x:1}}]));
});
test('native package round-trip validates JSON without running embedded player code',async()=>{
 const {createMotionArchive}=await import('../src/shared/motion-export'),{readMotionArchive}=await import('../src/shared/motion-import');const doc=documentSchema.parse({...createDocument('web'),schemaVersion:2,characters:[rig()],assets:[]});const bytes=await createMotionArchive(doc,'throw new Error("never execute")');assert.deepEqual(await readMotionArchive(bytes),JSON.parse(JSON.stringify(doc)));const JSZip=(await import('jszip')).default,zip=new JSZip();zip.file('../document.json','{}');await assert.rejects(()=>readMotionArchive(bytes.slice(0,20)));const unsafe=await zip.generateAsync({type:'uint8array'});await assert.rejects(()=>readMotionArchive(unsafe),/Unsafe/);
});
