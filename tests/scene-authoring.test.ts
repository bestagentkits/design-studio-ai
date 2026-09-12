import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createDocument } from '../src/shared/catalog';
import { mutateDocument } from '../src/shared/operations';
import { inspectScene } from '../src/shared/scene-inspection';
import { buildScene, disposeScene } from '../src/shared/scene-runtime';
import { boneWorld } from '../src/shared/scene-rigging';
import { documentSchema } from '../src/shared/schema';
import { interpolateNode } from '../src/shared/render';
function setup(){const doc=createDocument('3d','Puppy');doc.pages[0].nodes=[{id:'body',type:'model3d',name:'body',x:0,y:0,width:400,height:400,data:{geometry:'sphere'},scene:{position:[0,0,0],scale:[1,1,1]}}];return doc;}
function command(doc:ReturnType<typeof setup>,command:unknown){return mutateDocument(doc,[{op:'scene-command',pageId:doc.pages[0].id,command}]);}
test('remesh produces a closed surface and preserves original primitives',()=>{let doc=setup();doc.pages[0].nodes.push({...doc.pages[0].nodes[0],id:'head',scene:{position:[0,1,0],scale:[.7,.7,.7]}});const before=JSON.stringify(doc);const next=command(doc,{action:'remesh',nodeIds:['body','head'],outputId:'skin',resolution:16,symmetry:true});assert.equal(JSON.stringify(doc),before);assert.equal(next.pages[0].nodes[0].visible,false);const result=inspectScene(next).pages[0].nodes.find(n=>n.id==='skin')!;assert('triangles' in result&&result.triangles!>100);assert.deepEqual(result.issues,[]);assert.throws(()=>command(doc,{action:'remesh',nodeIds:['missing'],outputId:'skin'}));});
test('loft creates joint rings and closed caps with consistent winding',()=>{const next=command(setup(),{action:'loft',outputId:'leg',rings:[{center:[0,0,0],radius:.3},{center:[0,1,0],radius:.3},{center:[0,2,.2],radius:.2}],segments:12});const report=inspectScene(next).pages[0].nodes.find(n=>n.id==='leg')!;assert.deepEqual(report.issues,[]);});
test('auto weights normalize, skin responds to pose, playback preserves bind state',async()=>{let doc=command(setup(),{action:'convert',nodeId:'body'});doc=command(doc,{action:'rig-quadruped',nodeId:'body'});doc=command(doc,{action:'bind',nodeId:'body'});const mesh=doc.pages[0].nodes[0].scene!.mesh!;for(let i=0;i<mesh.positions.length/3;i++)assert(Math.abs(mesh.skinWeights!.slice(i*4,i*4+4).reduce((a,b)=>a+b,0)-1)<1e-6);const original=JSON.stringify(doc);doc=command(doc,{action:'clip',nodeId:'body',preset:'idle',duration:2});const before=JSON.stringify(doc);const {scene}=await buildScene(doc,0,.5);const skin=scene.getObjectByName('body') as T.SkinnedMesh;assert(skin.isSkinnedMesh);scene.updateMatrixWorld(true);skin.skeleton.update();let moved=0;for(let i=0;i<mesh.positions.length/3;i++){const a=new T.Vector3().fromArray(mesh.positions,i*3);if(skin.applyBoneTransform(i,a.clone()).distanceTo(a)>.00001)moved++;}assert(moved>mesh.positions.length/3*.25,`Pose should deform most skinned vertices, only ${moved} of ${mesh.positions.length/3} moved`);assert.equal(JSON.stringify(doc),before);disposeScene(scene);assert.notEqual(original,before);});
test('IK moves endpoint toward local-space target',()=>{let doc=command(setup(),{action:'convert',nodeId:'body'});doc=command(doc,{action:'rig-quadruped',nodeId:'body'});const bones=doc.pages[0].nodes[0].scene!.bones!,end=bones.findIndex(b=>b.name==='frontLeftFoot'),origin=new T.Vector3().setFromMatrixPosition(boneWorld(bones)[end]),target=origin.clone().add(new T.Vector3(0,.2,.15));const next=command(doc,{action:'ik',nodeId:'body',endBone:'frontLeftFoot',target:target.toArray()});const result=new T.Vector3().setFromMatrixPosition(boneWorld(next.pages[0].nodes[0].scene!.bones!)[end]);assert(result.distanceTo(target)<.01,`IK left a residual of ${result.distanceTo(target)}`);});
test('morph targets animate without mutating geometry; UV packing preserves skin/morph data',()=>{let doc=command(setup(),{action:'convert',nodeId:'body'});doc=command(doc,{action:'rig-quadruped',nodeId:'body'});doc=command(doc,{action:'bind',nodeId:'body'});doc=command(doc,{action:'morph',nodeId:'body',name:'blink',vertices:[1,2,3],delta:[0,-.2,0],weight:0});doc.timeline={duration:1,fps:30,tracks:[{id:'blink',nodeId:'body',keyframes:[{time:0,values:{'scene.morphWeights.blink':0}},{time:1,values:{'scene.morphWeights.blink':1}}]}]};assert.equal(interpolateNode(doc.pages[0].nodes[0],doc,.5).scene!.morphWeights!.blink,.5);const next=command(doc,{action:'uv-pack',nodeId:'body'}),mesh=next.pages[0].nodes[0].scene!.mesh!;assert.equal(mesh.uv!.length,mesh.positions.length/3*2);assert.equal(mesh.skinWeights!.length,mesh.positions.length/3*4);assert.equal(mesh.morphTargets![0].positions.length,mesh.positions.length);assert(documentSchema.safeParse(next).success);});
test('invalid operations are atomic and topology edits cannot silently invalidate rigs',()=>{const doc=command(setup(),{action:'convert',nodeId:'body'}),before=JSON.stringify(doc);assert.throws(()=>command(doc,{action:'morph',nodeId:'body',name:'oops',vertices:[999999],delta:[0,1,0]}));assert.equal(JSON.stringify(doc),before);assert.throws(()=>command(doc,{action:'bind',nodeId:'body'}));});

test('rigid accessories bake transforms, follow poses and inherit generated clips',async()=>{
  let doc=command(setup(),{action:'convert',nodeId:'body'});doc=command(doc,{action:'rig-quadruped',nodeId:'body'});doc.pages[0].nodes.push({id:'eye',name:'eye',type:'model3d',x:0,y:0,width:100,height:100,data:{geometry:'sphere'},scene:{position:[.4,.8,.5],scale:[.1,.1,.1]}});doc=command(doc,{action:'convert',nodeId:'eye'});doc=command(doc,{action:'attach',nodeId:'eye',rigNodeId:'body',bone:'head'});const eye=doc.pages[0].nodes[1];assert.equal(eye.scene!.scale![0],1);assert(Math.abs(eye.scene!.mesh!.positions[1]-.9)<1e-5);doc=command(doc,{action:'pose',nodeId:'body',bone:'head',rotation:[0,10,0]});assert.deepEqual(doc.pages[0].nodes[1].scene!.bones,doc.pages[0].nodes[0].scene!.bones);doc=command(doc,{action:'clip',nodeId:'body',preset:'idle'});assert.equal(doc.timeline!.tracks.length,2);
});

test('topology and paint reject invalid authoring order without partial changes',()=>{let doc=command(setup(),{action:'convert',nodeId:'body'});doc=command(doc,{action:'paint',nodeId:'body',uv:[.5,.5],radius:.1,color:'#ff0000'});const before=JSON.stringify(doc);assert.throws(()=>command(doc,{action:'uv-pack',nodeId:'body'}),/Clear texture paint/);assert.equal(JSON.stringify(doc),before);doc=command(doc,{action:'rig-quadruped',nodeId:'body'});doc=command(doc,{action:'bind',nodeId:'body'});assert.throws(()=>command(doc,{action:'relax',nodeId:'body'}),/topology/);});

test('triangle BVH remeshing reconstructs closed document meshes',()=>{let doc=setup();doc.pages[0].nodes[0].data={geometry:'box'};doc=command(doc,{action:'convert',nodeId:'body'});const next=command(doc,{action:'remesh',nodeIds:['body'],outputId:'retopo',resolution:16,symmetry:true});const report=inspectScene(next).pages[0].nodes.find(n=>n.id==='retopo')!;assert.deepEqual(report.issues,[]);assert('vertices' in report&&report.vertices!>30);});

test('symmetric multi-part remesh has consistent outward faces at thin limb intersections',()=>{
  const doc=setup();
  const parts=[[[0,1.12,-.4],[.63,.67,.95]],[[0,1.55,.32],[.52,.55,.48]],[[0,2,.63],[.84,.78,.74]],...[-.43,.43].flatMap(x=>[.43,-1].map(z=>[[x,.65,z],[.235,.54,.25]]))];
  doc.pages[0].nodes=parts.map(([position,scale],i)=>({...doc.pages[0].nodes[0],id:`part-${i}`,scene:{position:position as [number,number,number],scale:scale as [number,number,number]}}));
  const next=command(doc,{action:'remesh',nodeIds:doc.pages[0].nodes.map(n=>n.id),outputId:'skin',resolution:48,symmetry:true,blend:.08});
  const report=inspectScene(next).pages[0].nodes.find(n=>n.id==='skin')!;assert.deepEqual(report.issues,[]);
  const mesh=next.pages[0].nodes.at(-1)!.scene!.mesh!;let volume=0;
  for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=mesh.indices.slice(i,i+3).map(j=>new T.Vector3().fromArray(mesh.positions,j*3));volume+=a.dot(b.cross(c));}assert(volume>0);
});

test('shared rigs reuse one runtime skeleton and preserve legacy skin deformation',async()=>{
 let doc=command(setup(),{action:'convert',nodeId:'body'});doc=command(doc,{action:'rig-quadruped',nodeId:'body'});doc=command(doc,{action:'bind',nodeId:'body'});
 doc.pages[0].nodes.push({...structuredClone(doc.pages[0].nodes[0]),id:'eye',name:'eye',scene:{position:[0,.8,0],scale:[.1,.1,.1]}});
 doc=command(doc,{action:'convert',nodeId:'eye'});doc=command(doc,{action:'attach',nodeId:'eye',rigNodeId:'body',bone:'head'});doc=command(doc,{action:'clip',nodeId:'body',preset:'idle'});
 const divergent=structuredClone(doc);delete divergent.timeline!.tracks.find(t=>t.nodeId==='eye')!.clipName;assert.throws(()=>command(divergent,{action:'share-rig',nodeId:'body'}),/different bind space or animation/);
 const muted=structuredClone(doc);muted.timeline!.tracks.find(t=>t.nodeId==='eye')!.muted=true;assert.throws(()=>command(muted,{action:'share-rig',nodeId:'body'}),/different bind space or animation/);
 const rounded=structuredClone(doc);rounded.pages[0].nodes[1].scene!.bones![1].position[1]+=1e-14;assert.doesNotThrow(()=>command(rounded,{action:'share-rig',nodeId:'body'}));
 const before=inspectScene(doc,undefined,.5);const next=command(doc,{action:'share-rig',nodeId:'body'});assert.equal(next.pages[0].nodes[1].scene!.rigId,'body');assert.equal(next.timeline!.tracks.length,1);assert.deepEqual(inspectScene(next,undefined,.5),before);
 const {buildScene,animateScene,disposeScene}=await import('../src/shared/scene-runtime');const built=await buildScene(next);try{const body=built.objects.get('body') as T.SkinnedMesh,eye=built.objects.get('eye') as T.SkinnedMesh;assert.equal(body.skeleton,eye.skeleton);animateScene(built.scene,next,0,.5);assert(body.skeleton.bones[4].rotation.x!==0);}finally{disposeScene(built.scene);}
});
test('clip edits are scoped, loop at new speed and leave source keyframes intact',()=>{
 let doc=command(setup(),{action:'convert',nodeId:'body'});doc=command(doc,{action:'rig-quadruped',nodeId:'body'});doc=command(doc,{action:'clip',nodeId:'body',preset:'idle',start:0,duration:2});doc=command(doc,{action:'clip',nodeId:'body',preset:'wag',start:4,duration:2});const keys=structuredClone(doc.timeline!.tracks);
 const next=command(doc,{action:'edit-clip',nodeId:'body',name:'idle-0',speed:2,amplitude:.5,repeat:2});assert.deepEqual(next.timeline!.tracks,keys);assert.equal(next.pages[0].nodes[0].scene!.clips![1].end,6);
 const n=next.pages[0].nodes[0],a=interpolateNode(n,next,.25).scene!.bones![4].rotation![0],b=interpolateNode(n,next,1.25).scene!.bones![4].rotation![0];assert(Math.abs(a-2.5)<1e-6);assert.equal(a,b);assert.equal(interpolateNode(n,next,3).scene!.bones![4].rotation![0],0);
});

test('brush respects locked weights and vertices and edge split transfers all vertex attributes',()=>{
 let doc=command(setup(),{action:'convert',nodeId:'body'});doc=command(doc,{action:'rig-quadruped',nodeId:'body'});doc=command(doc,{action:'bind',nodeId:'body'});doc=command(doc,{action:'morph',nodeId:'body',name:'smile',vertices:[0,1],delta:[0,.1,0]});
 const node=doc.pages[0].nodes[0],m=node.scene!.mesh!,before=structuredClone(m),center=m.positions.slice(0,3);
 const next=command(doc,{action:'weight-brush',nodeId:'body',bone:'head',center,radius:10,mode:'add',strength:.5,lockedVertices:[0],lockedBones:['root']});const after=next.pages[0].nodes[0].scene!.mesh!;assert.deepEqual(after.skinWeights!.slice(0,4),before.skinWeights!.slice(0,4));
 for(let i=0;i<m.positions.length/3;i++){const weight=(mesh:typeof m)=>mesh.skinWeights!.slice(i*4,i*4+4).reduce((s,w,j)=>s+(mesh.skinIndices![i*4+j]===0?w:0),0);assert(Math.abs(weight(before)-weight(after))<1e-10);assert(Math.abs(after.skinWeights!.slice(i*4,i*4+4).reduce((a,b)=>a+b,0)-1)<1e-8);}
 const edge=m.indices.slice(0,2),refined=command(next,{action:'split-edges',nodeId:'body',edges:[edge]}).pages[0].nodes[0].scene!.mesh!;assert.equal(refined.positions.length,m.positions.length+3);assert.equal(refined.morphTargets![0].positions.length,refined.positions.length);assert.equal(refined.uv!.length,refined.positions.length/3*2);assert.equal(refined.skinIndices!.length,refined.positions.length/3*4);
});
test('persistent world contact keeps a transformed foot at its target without mutating saved pose',async()=>{
 let doc=command(setup(),{action:'convert',nodeId:'body'});doc=command(doc,{action:'rig-quadruped',nodeId:'body'});doc=command(doc,{action:'bind',nodeId:'body'});doc=command(doc,{action:'clip',nodeId:'body',preset:'walk'});
 const node=doc.pages[0].nodes[0];node.scene!.position=[2,1,-1];node.scene!.rotation=[0,35,0];node.scene!.scale=[2,2,2];
 const {nodeMatrix}=await import('../src/shared/scene-constraints'),{scenePose}=await import('../src/shared/scene-shared-rig');const bones=node.scene!.bones!,i=bones.findIndex(b=>b.name==='frontLeftFoot'),transform=nodeMatrix(node,doc.pages[0]);const target=new T.Vector3().setFromMatrixPosition(boneWorld(bones)[i]).applyMatrix4(transform),pole=target.clone().add(new T.Vector3(0,2,2));
 doc=command(doc,{action:'contact',nodeId:'body',id:'foot-contact',endBone:'frontLeftFoot',target:target.toArray(),pole:pole.toArray(),start:0,end:2,maxAngle:180});const saved=JSON.stringify(doc);
 for(let t=0;t<=2;t+=.1){const pose=scenePose(doc.pages[0].nodes[0],doc,t),foot=new T.Vector3().setFromMatrixPosition(boneWorld(pose.scene!.bones!)[i]).applyMatrix4(transform);assert(foot.distanceTo(target)<.0001);}
 assert.equal(JSON.stringify(doc),saved);
});

test('joint loop transfers attributes and a persisted checkpoint restores the original surface',()=>{
 let doc=command(setup(),{action:'convert',nodeId:'body'});doc=command(doc,{action:'rig-quadruped',nodeId:'body'});doc=command(doc,{action:'bind',nodeId:'body'});doc=command(doc,{action:'morph',nodeId:'body',name:'smile',vertices:[0],delta:[0,.1,0]});
 const original=structuredClone(doc.pages[0].nodes[0].scene!.mesh!);doc=command(doc,{action:'checkpoint',nodeId:'body',outputId:'original'});doc=command(doc,{action:'insert-loop',nodeId:'body',axis:'y',offset:.13});
 const mesh=doc.pages[0].nodes[0].scene!.mesh!;assert(mesh.positions.length>original.positions.length);assert.equal(mesh.uv!.length,mesh.positions.length/3*2);assert.equal(mesh.morphTargets![0].positions.length,mesh.positions.length);assert.deepEqual(inspectScene(doc).pages[0].nodes[0].diagnostics?.filter(d=>d.severity==='warning'),[]);
 doc=command(doc,{action:'restore-mesh',nodeId:'body',sourceId:'original'});assert.deepEqual(doc.pages[0].nodes[0].scene!.mesh,original);
});

test('shared skin retains world-space deformation under animated character transforms',async()=>{
 let doc=command(setup(),{action:'convert',nodeId:'body'});doc=command(doc,{action:'rig-quadruped',nodeId:'body'});doc=command(doc,{action:'bind',nodeId:'body'});
 doc.pages[0].nodes.push({...structuredClone(doc.pages[0].nodes[0]),id:'eye',name:'eye',scene:{position:[0,.8,0],scale:[.1,.1,.1]}});doc=command(doc,{action:'convert',nodeId:'eye'});doc=command(doc,{action:'attach',nodeId:'eye',rigNodeId:'body',bone:'head'});doc=command(doc,{action:'clip',nodeId:'body',preset:'idle'});
 for(const n of doc.pages[0].nodes){n.scene!.position=[2,1,-1];n.scene!.scale=[1.5,1.5,1.5];doc.timeline!.tracks.push({id:n.id+'-move',nodeId:n.id,keyframes:[{time:0,values:{'scene.position.x':2}},{time:2,values:{'scene.position.x':3}}]});}
 const shared=command(doc,{action:'share-rig',nodeId:'body'}),{buildScene,animateScene,disposeScene}=await import('../src/shared/scene-runtime'),old=await buildScene(doc),next=await buildScene(shared);
 try{for(const time of [0,.5,1,2]){animateScene(old.scene,doc,0,time);animateScene(next.scene,shared,0,time);old.scene.updateMatrixWorld(true);next.scene.updateMatrixWorld(true);for(const id of ['body','eye']){const a=old.objects.get(id) as T.SkinnedMesh,b=next.objects.get(id) as T.SkinnedMesh;a.skeleton.update();b.skeleton.update();for(let i=0;i<20;i++){const p=a.getVertexPosition(i,new T.Vector3()).applyMatrix4(a.matrixWorld),q=b.getVertexPosition(i,new T.Vector3()).applyMatrix4(b.matrixWorld);assert(p.distanceTo(q)<1e-5);}}}}finally{disposeScene(old.scene);disposeScene(next.scene);}
});
